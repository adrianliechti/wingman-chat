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
	"github.com/adrianliechti/wingman-chat/pkg/store"
	storefile "github.com/adrianliechti/wingman-chat/pkg/store/file"
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

	if cfg.Store != nil {
		var provider store.Provider
		var err error

		switch cfg.Store.Type {
		case "file", "":
			provider, err = storefile.New(cfg.Store.Path)
		default:
			err = fmt.Errorf("unknown store type: %s", cfg.Store.Type)
		}

		if err != nil {
			panic(fmt.Errorf("store: %w", err))
		}

		storesrv.New(provider).Attach(mux, prefix)
	}

	if info, err := os.Stat(skillsDir); err == nil && info.IsDir() {
		library.NewSkills(skillsDir).Attach(mux)
	}

	public.New(cfg, dist).Attach(mux)

	return mux
}
