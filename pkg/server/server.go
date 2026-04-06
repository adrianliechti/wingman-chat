package server

import (
	"io/fs"
	"net/http"
	"net/url"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server/api"
	"github.com/adrianliechti/wingman-chat/pkg/server/otel"
	"github.com/adrianliechti/wingman-chat/pkg/server/public"
)

func New(cfg *config.Config, url *url.URL, token string, dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	if cfg.Telemetry != nil {
		otel.New().Attach(mux)
	}

	api.New(token, url).Attach(mux)

	public.New(cfg, dist).Attach(mux)

	return mux
}
