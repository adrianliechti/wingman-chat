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

	handler := server.New(cfg, url, token, dist)
	http.ListenAndServe(":8000", handler)
}
