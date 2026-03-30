package realtime

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

type Handler struct {
	token string
	url   *url.URL
}

func New(token string, url *url.URL) *Handler {
	return &Handler{
		token: token,
		url:   url,
	}
}

func (h *Handler) Attach(mux *http.ServeMux) {
	mux.Handle("/api/v1/realtime", http.StripPrefix("/api", &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(h.url)

			if h.token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+h.token)
			}
		},
	}))
}
