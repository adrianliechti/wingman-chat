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
	mux.Handle(h.prefix+"/", http.StripPrefix(h.prefix, &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(h.url)

			if h.token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+h.token)
			}
		},
	}))
}
