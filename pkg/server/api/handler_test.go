package api

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestProxyAnswersTheAppOnly(t *testing.T) {
	var seen []string

	// The gateway allows every origin; the proxy must not rely on it to keep others out.
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write([]byte("ok"))
	}))
	defer gateway.Close()

	target, err := url.Parse(gateway.URL)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	New("/api", "server-token", target).Attach(mux)

	tests := []struct {
		name    string
		method  string
		headers map[string]string
		want    int
		reached string
	}{
		{name: "the app", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": "https://chat.example.test"}, want: http.StatusOK, reached: "POST /v1/responses Bearer server-token"},
		{name: "the app with its own credentials", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "same-origin", "Authorization": "Bearer user-token"}, want: http.StatusOK, reached: "POST /v1/responses Bearer user-token"},
		{name: "an address typed into the browser", method: http.MethodGet, headers: map[string]string{"Sec-Fetch-Site": "none"}, want: http.StatusOK, reached: "GET /v1/responses Bearer server-token"},
		{name: "a client that is not a browser", method: http.MethodPost, want: http.StatusOK, reached: "POST /v1/responses Bearer server-token"},
		{name: "the app's WebSocket handshake without Fetch Metadata", method: http.MethodGet, headers: map[string]string{"Origin": "https://chat.example.test"}, want: http.StatusOK, reached: "GET /v1/responses Bearer server-token"},

		{name: "a shared page", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "null"}, want: http.StatusForbidden},
		{name: "a shared page with made-up credentials", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "null", "Authorization": "Bearer anything"}, want: http.StatusForbidden},
		{name: "a shared page's preflight", method: http.MethodOptions, headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "null", "Access-Control-Request-Method": "POST"}, want: http.StatusForbidden},
		{name: "a shared page's WebSocket handshake without Fetch Metadata", method: http.MethodGet, headers: map[string]string{"Origin": "null"}, want: http.StatusForbidden},
		{name: "another site", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://elsewhere.example.test"}, want: http.StatusForbidden},
		{name: "another subdomain", method: http.MethodPost, headers: map[string]string{"Sec-Fetch-Site": "same-site", "Origin": "https://other.example.test"}, want: http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			seen = nil

			req := httptest.NewRequest(tt.method, "/api/v1/responses", nil)
			for name, value := range tt.headers {
				req.Header.Set(name, value)
			}
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)

			if res.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", res.Code, tt.want, res.Body)
			}

			if tt.reached == "" {
				// A refusal comes from this server: it never reaches the gateway
				// and carries none of the gateway's permissive CORS headers.
				if len(seen) != 0 || res.Header().Get("Access-Control-Allow-Origin") != "" {
					t.Fatalf("refused request reached the gateway %v, headers %v", seen, res.Header())
				}
				return
			}

			if len(seen) != 1 || seen[0] != tt.reached {
				t.Fatalf("gateway saw %v, want %q", seen, tt.reached)
			}
		})
	}
}
