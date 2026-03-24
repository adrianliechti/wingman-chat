package main

import (
	"net/http"
	"os"

	"github.com/adrianliechti/wingman-chat/pkg/config"
	"github.com/adrianliechti/wingman-chat/pkg/server"
)

func main() {
	cfg := config.Load()

	token := config.PlatformToken()
	platformURL := config.PlatformURL()
	realtimeURL := config.RealtimeURL()

	dist := os.DirFS("dist")

	handler := server.New(cfg, token, platformURL, realtimeURL, dist)
	http.ListenAndServe(":8000", handler)
}
