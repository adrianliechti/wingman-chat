package main

import (
	"fmt"
	"net"
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

	skillsDir := os.Getenv("SKILLS_PATH")
	if skillsDir == "" {
		skillsDir = "skills"
	}

	handler := server.New(cfg, prefix, url, token, dist, skillsDir)

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		fmt.Fprintf(os.Stderr, "listen on :%s: %v\n", port, err)
		os.Exit(1)
	}

	fmt.Printf("listening on http://localhost:%s\n", port)
	http.Serve(listener, handler)
}
