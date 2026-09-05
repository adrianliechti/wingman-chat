package server

import (
	"io/fs"
	"net/http"
	"net/url"
	"os"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server/api"
	"github.com/adrianliechti/wingman-chat/pkg/server/drive"
	"github.com/adrianliechti/wingman-chat/pkg/server/library"
	"github.com/adrianliechti/wingman-chat/pkg/server/otel"
	"github.com/adrianliechti/wingman-chat/pkg/server/public"
)

func New(cfg *config.Config, prefix string, url *url.URL, token string, dist fs.FS, skillsDir string) http.Handler {
	mux := http.NewServeMux()

	if cfg.Telemetry != nil {
		otel.New().Attach(mux)
	}

	api.New(prefix, token, url).Attach(mux)

	if len(cfg.Drives) > 0 {
		drive.New(cfg.Drives).Attach(mux, prefix)
	}

	if info, err := os.Stat(skillsDir); err == nil && info.IsDir() {
		library.NewSkills(skillsDir).Attach(mux)
	}

	public.New(cfg, dist).Attach(mux)

	return mux
}
