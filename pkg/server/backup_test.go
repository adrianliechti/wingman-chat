package server

import (
	"context"
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
	storeonedrive "github.com/adrianliechti/wingman-chat/pkg/store/onedrive"
)

func TestDefaultBackupConfigurationNeedsNoDriveConnection(t *testing.T) {
	data, err := os.ReadFile("../../public/config.json")
	if err != nil {
		t.Fatal(err)
	}
	var cfg config.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	provider, middleware, err := backupProvider(&cfg)
	if err != nil {
		t.Fatalf("default configuration cannot start without drives.yaml: %v", err)
	}
	if provider != nil || middleware != nil {
		t.Fatal("default configuration enabled online backup")
	}
}

func TestBackupProviderSelection(t *testing.T) {
	for _, provider := range []string{"", "local", "server", "onedrive", "typo"} {
		t.Run(provider, func(t *testing.T) {
			cfg := &config.Config{Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
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
func TestBackupDriveValidation(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive"}}
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("missing connection accepted")
	}
	cfg.Drives = []config.Drive{{ID: "first", Type: "onedrive"}, {ID: "second", Type: "onedrive"}}
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("ambiguous connection accepted")
	}
	cfg.Backup.Drive = "second"
	selected, err := backupDrive(cfg)
	if err != nil || selected.ID != "second" {
		t.Fatalf("explicit selection: %v %v", selected, err)
	}
	cfg.Backup.Drive = "missing"
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("unknown connection accepted")
	}
}
func TestOneDriveMiddlewareRequiresTokenAndScopesRoutes(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "onedrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
	selected, middleware, err := backupProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	storesrv.New(selected, middleware).Attach(mux, "/api")
	mux.HandleFunc("GET /api/v1/models", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	for _, test := range []struct {
		path   string
		status int
	}{{"/api/v1/me", 200}, {"/api/v1/keystore", 401}, {"/api/v1/models", 204}} {
		r := httptest.NewRequest("GET", test.path, nil)
		r.Header.Set("X-Forwarded-User", "alice")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("%s: %d %s", test.path, w.Code, w.Body.String())
		}
		if test.path == "/api/v1/me" && w.Header().Get("X-Backup-Destination") == "" {
			t.Fatal("resolved destination missing")
		}
	}
	// With no exchange configured, forwarding a Graph token reaches the provider.
	// A canceled context makes the subsequent network operation fail locally.
	for _, header := range []string{"Authorization", "X-Forwarded-Access-Token"} {
		next := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			if _, err := selected.ListChats(ctx, "alice"); err == nil || !strings.Contains(err.Error(), "context canceled") {
				t.Fatalf("token did not reach provider: %v", err)
			}
			w.WriteHeader(204)
		}))
		r := httptest.NewRequest("GET", "/api/v1/keystore", nil)
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
		Backup: &config.Backup{Provider: "onedrive"},
		Drives: []config.Drive{{ID: "personal", Type: "onedrive", Auth: &auth}},
	}
}

func serveBackup(t *testing.T, cfg *config.Config) *http.ServeMux {
	t.Helper()
	selected, middleware, err := backupProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	storesrv.New(selected, middleware).Attach(mux, "/api")
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
	w := request(mux, "GET", "/api/v1/keystore", "Authorization", "Bearer user-token")
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
	request(mux, "GET", "/api/v1/keystore", "Authorization", "Bearer user-token")
	if len(fake.assertions) != 1 || fake.assertions[0] != "user-token Files.ReadWrite.AppFolder" {
		t.Fatalf("scope: %q", fake.assertions)
	}
}

func TestOneDriveExchangeFailureAsksToReconnect(t *testing.T) {
	fake := useFakeMicrosoft(t)
	fake.failExchange = true
	mux := serveBackup(t, oboConfig(config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret"}))
	w := request(mux, "GET", "/api/v1/keystore", "Authorization", "Bearer revoked")
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

func TestBackupDestinationIdentity(t *testing.T) {
	useFakeMicrosoft(t)
	destination := func(cfg *config.Config) string {
		t.Helper()
		w := request(serveBackup(t, cfg), "GET", "/api/v1/me")
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("me: %d cache=%q", w.Code, w.Header().Get("Cache-Control"))
		}
		return w.Header().Get("X-Backup-Destination")
	}
	auth := config.DriveAuth{Issuer: "https://login.test/tenant", ClientID: "app", ClientSecret: "secret"}
	base := destination(oboConfig(auth))
	if base != destination(oboConfig(auth)) {
		t.Fatal("destination is not stable across restarts")
	}
	if strings.Contains(base, "personal") || strings.Contains(base, "secret") || strings.Contains(base, "app") {
		t.Fatalf("destination leaks configuration: %s", base)
	}
	rotated := auth
	rotated.ClientSecret = "rotated"
	if destination(oboConfig(rotated)) != base {
		t.Fatal("rotating the client secret changed the backup destination")
	}
	otherClient := auth
	otherClient.ClientID = "other-app"
	otherDrive := oboConfig(auth)
	otherDrive.Drives[0].ID = "work"
	noAuth := &config.Config{Backup: &config.Backup{Provider: "onedrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
	for name, cfg := range map[string]*config.Config{"client": oboConfig(otherClient), "drive": otherDrive, "no auth": noAuth} {
		if destination(cfg) == base {
			t.Fatalf("%s change kept the same destination", name)
		}
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
			selected, middleware, err := backupProvider(&config.Config{Backup: &config.Backup{Provider: "onedrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}})
			if err != nil {
				t.Fatal(err)
			}
			// Call the middleware directly: the identity layer rejects forwarded
			// tokens that are not JWTs before the store would be reached.
			next := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				selected.ListChats(r.Context(), "alice")
			}))
			request(next, "GET", "/api/v1/keystore", test.headers...)
			if len(fake.graphTokens) == 0 || fake.graphTokens[0] != test.want {
				t.Fatalf("Graph received %q, want %q", fake.graphTokens, test.want)
			}
		})
	}
}

func TestEveryOneDriveRouteExceptMeRequiresToken(t *testing.T) {
	source, err := os.ReadFile("store/handler.go")
	if err != nil {
		t.Fatal(err)
	}
	routes := regexp.MustCompile(`handle\("([A-Z]+) "\+prefix\+"([^"]+)"`).FindAllStringSubmatch(string(source), -1)
	if len(routes) < 10 {
		t.Fatalf("route table not found: %d routes", len(routes))
	}
	fake := useFakeMicrosoft(t)
	mux := serveBackup(t, &config.Config{Backup: &config.Backup{Provider: "onedrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}})
	for _, route := range routes {
		method, path := route[1], "/api"+strings.ReplaceAll(route[2], "{id}", "chat-0001")
		if path == "/api/v1/me" {
			continue
		}
		if w := request(mux, method, path); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without token: %d", method, path, w.Code)
		}
	}
	// The decoded path ends in /v1/me, but the route is not the identity endpoint.
	w := request(mux, "GET", "/api/v1/files/x%2Fv1%2Fme")
	if w.Code != http.StatusUnauthorized || w.Header().Get("X-Backup-Destination") != "" {
		t.Errorf("encoded /v1/me suffix bypassed the token check: %d", w.Code)
	}
	if len(fake.graphTokens) != 0 {
		t.Fatalf("Graph called without a token: %q", fake.graphTokens)
	}
}

func TestBackupDriveIgnoresOtherDriveTypes(t *testing.T) {
	cfg := &config.Config{
		Backup: &config.Backup{Provider: "onedrive"},
		Drives: []config.Drive{{ID: "team", Type: "sharepoint"}, {ID: "files", Type: "local"}, {ID: "personal", Type: "onedrive"}},
	}
	selected, err := backupDrive(cfg)
	if err != nil || selected.ID != "personal" {
		t.Fatalf("sole OneDrive connection not selected: %v %v", selected, err)
	}
	cfg.Backup.Drive = "team"
	if _, err := backupDrive(cfg); err == nil {
		t.Fatal("SharePoint connection accepted as backup drive")
	}
}

func TestProviderNamesAreCaseSensitive(t *testing.T) {
	cfg := &config.Config{Backup: &config.Backup{Provider: "OneDrive"}, Drives: []config.Drive{{ID: "personal", Type: "onedrive"}}}
	if _, _, err := backupProvider(cfg); err == nil {
		t.Fatal("misspelled provider accepted")
	}
}

func TestServerBackupWiring(t *testing.T) {
	t.Run("invalid provider fails startup", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("server started with an invalid backup provider")
			}
		}()
		New(&config.Config{Backup: &config.Backup{Provider: "typo"}}, "/api", &url.URL{Scheme: "http", Host: "localhost"}, "", fstest.MapFS{}, t.TempDir())
	})
	t.Run("local backup mounts no store routes", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}))
		defer upstream.Close()
		target, _ := url.Parse(upstream.URL)
		mux := New(&config.Config{Backup: &config.Backup{Provider: "local"}}, "/api", target, "", fstest.MapFS{}, t.TempDir())
		// Unclaimed /api routes fall through to the model API proxy.
		if w := request(mux, "GET", "/api/v1/keystore", "Authorization", "Bearer token"); w.Code != http.StatusTeapot {
			t.Fatalf("keystore route mounted for local backup: %d", w.Code)
		}
	})
}
