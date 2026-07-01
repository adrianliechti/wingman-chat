package server

import (
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"

	chatstorepkg "github.com/adrianliechti/wingman-chat/pkg/chatstore"
	chatstorefile "github.com/adrianliechti/wingman-chat/pkg/chatstore/file"
	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server/api"
	chatstoresrv "github.com/adrianliechti/wingman-chat/pkg/server/chatstore"
	"github.com/adrianliechti/wingman-chat/pkg/server/drive"
	"github.com/adrianliechti/wingman-chat/pkg/server/library"
	"github.com/adrianliechti/wingman-chat/pkg/server/otel"
	"github.com/adrianliechti/wingman-chat/pkg/server/public"
)

func New(cfg *config.Config, prefix string, url *url.URL, token string, dist fs.FS, skillsDir, notebookDir string) http.Handler {
	mux := http.NewServeMux()

	if cfg.Telemetry != nil {
		otel.New().Attach(mux)
	}

	api.New(prefix, token, url).Attach(mux)

	if len(cfg.Drives) > 0 {
		drive.New(cfg.Drives).Attach(mux, prefix)
	}

	if cfg.ChatStore != nil {
		var provider chatstorepkg.Provider
		var err error

		switch cfg.ChatStore.Type {
		case "file", "":
			provider, err = chatstorefile.New(cfg.ChatStore.Path)
		default:
			err = fmt.Errorf("unknown chatstore type: %s", cfg.ChatStore.Type)
		}

		if err != nil {
			panic(fmt.Errorf("chatstore: %w", err))
		}

		chatstoresrv.New(provider).Attach(mux, prefix)
	}

	if dirExists(skillsDir) {
		library.NewSkills(skillsDir).Attach(mux)
	}

	if dirExists(notebookDir) {
		library.NewNotebooks(notebookDir).Attach(mux)
	}

	public.New(cfg, dist).Attach(mux)

	return mux
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
