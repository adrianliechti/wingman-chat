package server

import (
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server/api"
	"github.com/adrianliechti/wingman-chat/pkg/server/drive"
	"github.com/adrianliechti/wingman-chat/pkg/server/library"
	"github.com/adrianliechti/wingman-chat/pkg/server/me"
	"github.com/adrianliechti/wingman-chat/pkg/server/otel"
	"github.com/adrianliechti/wingman-chat/pkg/server/public"
	storesrv "github.com/adrianliechti/wingman-chat/pkg/server/store"
)

func New(cfg *config.Config, prefix string, url *url.URL, token string, dist fs.FS, skillsDir string) http.Handler {
	mux := http.NewServeMux()

	if cfg.Telemetry != nil {
		otel.New(cfg.Telemetry.Name).Attach(mux)
	}

	api.New(prefix, token, url).Attach(mux)

	me.New().Attach(mux)

	if len(cfg.Drives) > 0 {
		drive.New(cfg.Drives).Attach(mux, prefix)
	}

	provider, middleware, err := backupProvider(cfg)
	if err != nil {
		panic(fmt.Errorf("store: %w", err))
	}
	if provider != nil {
		handler, err := storesrv.New(provider, middleware).WithPinSecret(cfg.Backup.PinSecret)
		if err != nil {
			panic(fmt.Errorf("store: %w", err))
		}
		handler.Attach(mux, prefix)
	}

	if info, err := os.Stat(skillsDir); err == nil && info.IsDir() {
		library.NewSkills(skillsDir).Attach(mux)
	}

	public.New(cfg, dist).Attach(mux)

	return mux
}
