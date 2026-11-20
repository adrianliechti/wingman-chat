package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	storesrv "github.com/adrianliechti/wingman-chat/pkg/server/store"
	"github.com/adrianliechti/wingman-chat/pkg/store"
	storeonedrive "github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

func TestDefaultBackupConfigurationNeedsNoBackupConfig(t *testing.T) {
	data, err := os.ReadFile("../../public/config.json")
	if err != nil {
		t.Fatal(err)
	}
	var cfg config.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if _, _, err := backupProvider(&cfg); err != nil {
		t.Fatalf("default configuration cannot start without backup.yaml: %v", err)
	}
}

func TestDirectUploadKeyValidation(t *testing.T) {
	encode := func(n int) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, n)) }
	for _, test := range []struct {
		name, key string
		valid     bool
	}{
		{"unset", "", true},
		{"not base64", "not base64!", false},
		{"too short", encode(31), false},
		{"valid", encode(32), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := &config.Config{
				Backup: &config.Backup{Provider: "onedrive", DirectUploadKey: test.key},
			}
			selected, _, err := backupProvider(cfg)
			if (err == nil) != test.valid {
				t.Fatalf("got error %v, want valid=%v", err, test.valid)
			}
			if err == nil && selected.(store.DirectUploader).DirectUploadsEnabled() != (test.key != "") {
				t.Fatal("direct uploads enabled without a key, or disabled with one")
			}
		})
	}
}

func TestBackupProviderSelection(t *testing.T) {
	for _, provider := range []string{"", "local", "server", "onedrive", "typo"} {
		t.Run(provider, func(t *testing.T) {
			cfg := &config.Config{}
			if provider != "" {
				cfg.Backup = &config.Backup{Provider: provider}
			}
			selected, middleware, err := backupProvider(cfg)
			if provider == "typo" || provider == "server" {
				if err == nil {
					t.Fatal("invalid provider accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if provider == "local" || provider == "" {
				if selected != nil || middleware != nil {
					t.Fatal("local backup enabled remote storage")
				}
				return
			}
			if provider == "onedrive" {
				if _, ok := selected.(*storeonedrive.Provider); !ok || middleware == nil {
					t.Fatalf("wrong provider: %T", selected)
				}
			}
		})
	}
}

func TestOneDriveIgnoresDriveConnections(t *testing.T) {
	fake := useFakeMicrosoft(t)
	auth := config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret"}
	cfg := &config.Config{
		Backup: &config.Backup{Provider: "onedrive"},
		Drives: []config.Drive{{ID: "first", Type: "onedrive", Auth: &auth}, {ID: "second", Type: "onedrive", Auth: &auth}},
	}
	mux := serveBackup(t, cfg)
	request(mux, "GET", "/api/v1/store/keystore", "Authorization", "Bearer user-token")
	if len(fake.assertions) != 0 {
		t.Fatalf("backup used drives.yaml auth: %q", fake.assertions)
	}
}

func TestOneDriveMiddlewareRequiresTokenAndScopesRoutes(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive"}}
	selected, middleware, err := backupProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	storesrv.New(selected, middleware).Attach(mux, "/api/v1/store")
	mux.HandleFunc("GET /api/v1/models", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, test := range []struct {
		path   string
		status int
	}{{"/api/v1/store/keystore", 401}, {"/api/v1/models", 204}} {
		r := httptest.NewRequest("GET", test.path, nil)
		r.Header.Set("X-Forwarded-User", "alice")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("%s: %d %s", test.path, w.Code, w.Body.String())
		}
	}
	// With no exchange configured, forwarding a Graph token reaches the provider.
	// A canceled context makes the subsequent network operation fail locally.
	for _, header := range []string{"Authorization", "X-Forwarded-Access-Token"} {
		next := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			if _, err := selected.ListChats(ctx); err == nil || !strings.Contains(err.Error(), "context canceled") {
				t.Fatalf("token did not reach provider: %v", err)
			}
			w.WriteHeader(204)
		}))
		r := httptest.NewRequest("GET", "/api/v1/store/keystore", nil)
		if header == "Authorization" {
			r.Header.Set(header, "Bearer graph-token")
		} else {
			r.Header.Set(header, "graph-token")
		}
		w := httptest.NewRecorder()
		next.ServeHTTP(w, r)
		if w.Code != 204 {
			t.Fatalf("token header %s: %d", header, w.Code)
		}
	}
}

func TestStoreNamespaceRouting(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Upstream-Path", r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}

	for _, provider := range []string{"local", "onedrive"} {
		t.Run(provider, func(t *testing.T) {
			cfg := &config.Config{Backup: &config.Backup{Provider: provider}}
			handler := New(cfg, "/api", target, "", fstest.MapFS{}, "")
			keyStatus, resetStatus := http.StatusNotFound, http.StatusNotFound
			if provider == "onedrive" {
				keyStatus, resetStatus = http.StatusUnauthorized, http.StatusUnauthorized
			}
			tests := []struct {
				method, path string
				status       int
				upstreamPath string
			}{
				{http.MethodGet, "/api/v1/store/keystore", keyStatus, ""},
				{http.MethodDelete, "/api/v1/store", resetStatus, ""},
				{http.MethodGet, "/api/v1/store/unknown", http.StatusNotFound, ""},
				{http.MethodGet, "/api/v1/storefront", http.StatusNoContent, "/v1/storefront"},
				{http.MethodGet, "/api/v1/keystore", http.StatusNoContent, "/v1/keystore"},
				{http.MethodDelete, "/api/v1/backup", http.StatusNoContent, "/v1/backup"},
				{http.MethodGet, "/api/v1/backup/usage", http.StatusNoContent, "/v1/backup/usage"},
				{http.MethodGet, "/api/v1/chats", http.StatusNoContent, "/v1/chats"},
				{http.MethodGet, "/api/v1/files/file-1234", http.StatusNoContent, "/v1/files/file-1234"},
				{http.MethodPost, "/api/v1/blobs/blob-1234/upload-session", http.StatusNoContent, "/v1/blobs/blob-1234/upload-session"},
			}
			for _, test := range tests {
				got := request(handler, test.method, test.path)
				if path := got.Header().Get("X-Upstream-Path"); got.Code != test.status || path != test.upstreamPath {
					t.Errorf("%s %s: got status %d and upstream path %q, want %d and %q",
						test.method, test.path, got.Code, path, test.status, test.upstreamPath)
				}
			}
		})
	}
}

// fakeMicrosoft serves OIDC discovery, the OBO token endpoint, and Microsoft
// Graph through http.DefaultClient, which both obo and the OneDrive store use.
type fakeMicrosoft struct {
	mu           sync.Mutex
	failExchange bool
	assertions   []string
	graphTokens  []string
}

func (f *fakeMicrosoft) RoundTrip(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	respond := func(status int, body string) (*http.Response, error) {
		return &http.Response{StatusCode: status, Status: http.StatusText(status), Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	}
	switch {
	case r.URL.Host == "login.test" && r.URL.Path == "/tenant/.well-known/openid-configuration":
		return respond(200, `{"token_endpoint":"https://login.test/tenant/token"}`)
	case r.URL.Host == "login.test" && r.URL.Path == "/tenant/token":
		if err := r.ParseForm(); err != nil {
			return nil, err
		}
		f.assertions = append(f.assertions, r.PostForm.Get("assertion")+" "+r.PostForm.Get("scope"))
		if f.failExchange {
			return respond(400, `{"error":"invalid_grant"}`)
		}
		return respond(200, `{"access_token":"graph-for-`+r.PostForm.Get("assertion")+`","expires_in":3600}`)
	default:
		f.graphTokens = append(f.graphTokens, r.Header.Get("Authorization"))
		return respond(403, `{"error":{"code":"accessDenied"}}`)
	}
}

func useFakeMicrosoft(t *testing.T) *fakeMicrosoft {
	t.Helper()
	fake := &fakeMicrosoft{}
	previous := http.DefaultClient.Transport
	http.DefaultClient.Transport = fake
	t.Cleanup(func() { http.DefaultClient.Transport = previous })
	return fake
}

func oboConfig(auth config.DriveAuth) *config.Config {
	return &config.Config{
		Backup: &config.Backup{Provider: "onedrive", Auth: &auth},
	}
}

func serveBackup(t *testing.T, cfg *config.Config) *http.ServeMux {
	t.Helper()
	selected, middleware, err := backupProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	storesrv.New(selected, middleware).Attach(mux, "/api/v1/store")
	return mux
}

func request(mux http.Handler, method, path string, headers ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("X-Forwarded-User", "alice")
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestOneDriveExchangesTokenOnBehalfOfUser(t *testing.T) {
	fake := useFakeMicrosoft(t)
	mux := serveBackup(t, oboConfig(config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret"}))
	w := request(mux, "GET", "/api/v1/store/keystore", "Authorization", "Bearer user-token")
	if w.Code == http.StatusUnauthorized {
		t.Fatalf("exchange rejected: %s", w.Body.String())
	}
	if len(fake.assertions) != 1 || fake.assertions[0] != "user-token https://graph.microsoft.com/.default" {
		t.Fatalf("assertion/default scope: %q", fake.assertions)
	}
	if len(fake.graphTokens) == 0 {
		t.Fatal("provider did not call Graph")
	}
	for _, token := range fake.graphTokens {
		if token != "Bearer graph-for-user-token" {
			t.Fatalf("Graph received %q instead of the exchanged token", token)
		}
	}
}

func TestOneDriveUsesConfiguredExchangeScope(t *testing.T) {
	fake := useFakeMicrosoft(t)
	mux := serveBackup(t, oboConfig(config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret", Scope: "Files.ReadWrite.AppFolder"}))
	request(mux, "GET", "/api/v1/store/keystore", "Authorization", "Bearer user-token")
	if len(fake.assertions) != 1 || fake.assertions[0] != "user-token Files.ReadWrite.AppFolder" {
		t.Fatalf("scope: %q", fake.assertions)
	}
}

func TestOneDriveExchangeFailureAsksToReconnect(t *testing.T) {
	fake := useFakeMicrosoft(t)
	fake.failExchange = true
	mux := serveBackup(t, oboConfig(config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret"}))
	w := request(mux, "GET", "/api/v1/store/keystore", "Authorization", "Bearer revoked")
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "Reconnect your Microsoft account") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "invalid_grant") {
		t.Fatal("identity provider error leaked to the client")
	}
	if len(fake.graphTokens) != 0 {
		t.Fatalf("Graph called with unexchanged token: %q", fake.graphTokens)
	}
}

func TestInvalidExchangeConfigurationFailsStartup(t *testing.T) {
	useFakeMicrosoft(t)
	for name, auth := range map[string]config.DriveAuth{
		"missing secret":   {Issuer: "https://login.test/tenant", ClientID: "app"},
		"missing client":   {Issuer: "https://login.test/tenant", ClientSecret: "secret"},
		"failed discovery": {Issuer: "https://login.test/unknown", ClientID: "app", ClientSecret: "secret"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := backupProvider(oboConfig(auth)); err == nil {
				t.Fatal("invalid exchange configuration accepted")
			}
		})
	}
}

func TestOneDriveTokenHeaderPrecedence(t *testing.T) {
	for _, test := range []struct {
		name    string
		headers []string
		want    string
	}{
		{"authorization wins", []string{"Authorization", "Bearer bearer-token", "X-Forwarded-Access-Token", "forwarded-token"}, "Bearer bearer-token"},
		{"empty bearer falls back", []string{"Authorization", "Bearer ", "X-Forwarded-Access-Token", "forwarded-token"}, "Bearer forwarded-token"},
		{"basic falls back", []string{"Authorization", "Basic dXNlcjpwYXNz", "X-Forwarded-Access-Token", "forwarded-token"}, "Bearer forwarded-token"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fake := useFakeMicrosoft(t)
			selected, middleware, err := backupProvider(&config.Config{Backup: &config.Backup{Provider: "onedrive"}})
			if err != nil {
				t.Fatal(err)
			}
			// Call the middleware directly: the identity layer rejects forwarded
			// tokens that are not JWTs before the store would be reached.
			next := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				selected.ListChats(r.Context())
			}))
			request(next, "GET", "/api/v1/store/keystore", test.headers...)
			if len(fake.graphTokens) == 0 || fake.graphTokens[0] != test.want {
				t.Fatalf("Graph received %q, want %q", fake.graphTokens, test.want)
			}
		})
	}
}

func TestEveryOneDriveRouteRequiresToken(t *testing.T) {
	source, err := os.ReadFile("store/handler.go")
	if err != nil {
		t.Fatal(err)
	}
	routes := regexp.MustCompile(`handle\("([A-Z]+) "\+basePath(?:\+"([^"]+)")?,`).FindAllStringSubmatch(string(source), -1)
	if len(routes) < 10 {
		t.Fatalf("route table not found: %d routes", len(routes))
	}
	fake := useFakeMicrosoft(t)
	mux := serveBackup(t, &config.Config{Backup: &config.Backup{Provider: "onedrive"}})
	for _, route := range routes {
		method, path := route[1], "/api/v1/store"+strings.ReplaceAll(route[2], "{id}", "chat-0001")
		if w := request(mux, method, path); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without token: %d", method, path, w.Code)
		}
	}
	if len(fake.graphTokens) != 0 {
		t.Fatalf("Graph called without a token: %q", fake.graphTokens)
	}
}

func TestProviderNamesAreCaseSensitive(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "OneDrive"}}
	if _, _, err := backupProvider(cfg); err == nil {
		t.Fatal("misspelled provider accepted")
	}
}

func TestServerRejectsInvalidBackupProvider(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("server started with an invalid backup provider")
		}
	}()
	New(&config.Config{Backup: &config.Backup{Provider: "typo"}}, "/api", &url.URL{Scheme: "http", Host: "localhost"}, "", fstest.MapFS{}, t.TempDir())
}
