package server

import (
	"io/fs"
	"net/http"
	"net/url"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server/api"
	"github.com/adrianliechti/wingman-chat/pkg/server/otel"
	"github.com/adrianliechti/wingman-chat/pkg/server/public"
	"github.com/adrianliechti/wingman-chat/pkg/server/realtime"
)

func New(cfg *config.Config, token string, platformURL, realtimeURL *url.URL, dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	otel.New().Attach(mux)
	
	if realtimeURL != nil {
		realtime.New(token, realtimeURL).Attach(mux)
	}

	api.New(token, platformURL).Attach(mux)

	public.New(cfg, dist).Attach(mux)

	return mux
}
