package api

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

type Handler struct {
	prefix string
	token  string
	url    *url.URL
}

func New(prefix, token string, url *url.URL) *Handler {
	return &Handler{
		prefix: prefix,
		token:  token,
		url:    url,
	}
}

func (h *Handler) Attach(mux *http.ServeMux) {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(h.url)

			if h.token != "" && r.In.Header.Get("Authorization") == "" {
				r.Out.Header.Set("Authorization", "Bearer "+h.token)
			}
		},
	}

	mux.Handle(h.prefix+"/", http.StripPrefix(h.prefix, appOnly(proxy)))
}

// appOnly answers the app's own pages and refuses other web origins. The
// gateway lets any origin read its responses and this proxy adds the server's
// token, so without it any page could use the gateway as this server. That
// includes shared artifact pages: they are served from this host but run with
// an opaque origin, and must reach AI helpers through the viewer instead.
// Clients that are not browsers send neither header and are not affected.
func appOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if foreign(r) {
			http.Error(w, "cross-site requests are not allowed", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// foreign reports whether a browser sent the request from another origin.
func foreign(r *http.Request) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "same-origin", "none":
		return false
	case "":
		// WebSocket handshakes and older browsers carry no Fetch Metadata, but
		// a sandboxed page still names its opaque origin.
		return r.Header.Get("Origin") == "null"
	default:
		return true
	}
}
