package main

import (
	"net/http"
	"os"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server"
)

func main() {
	cfg := config.Load()

	url := config.PlatformURL()
	token := config.PlatformToken()

	dist := os.DirFS("dist")

	port := os.Getenv("PORT")
	prefix := os.Getenv("PREFIX")

	if port == "" {
		port = "8000"
	}

	if prefix == "" {
		prefix = "/api"
	}

	skillsDir := os.Getenv("SKILLS_PATH")
	if skillsDir == "" {
		skillsDir = "skills"
	}

	handler := server.New(cfg, prefix, url, token, dist, skillsDir)
	// No ReadTimeout: backup uploads set their own body deadline, and
	// streaming responses must not be cut off.
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	srv.ListenAndServe()
}
