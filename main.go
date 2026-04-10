package main

import (
	"net/http"
	"os"

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

	handler := server.New(cfg, prefix, url, token, dist)
	http.ListenAndServe(":"+port, handler)
}
