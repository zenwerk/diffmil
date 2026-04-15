package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/zenwerk/diffmil/internal/diff"
	"github.com/zenwerk/diffmil/internal/static"
)

// New creates an HTTP handler that serves the diff API and embedded SPA.
func New(diffResp *diff.DiffResponse) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /_/api/diff", handleDiff(diffResp))
	mux.HandleFunc("GET /", handleSPA())

	return mux
}

func handleDiff(diffResp *diff.DiffResponse) http.HandlerFunc {
	data, err := json.Marshal(diffResp)
	if err != nil {
		slog.Error("failed to marshal diff response", "error", err)
		os.Exit(1)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}
}

func handleSPA() http.HandlerFunc {
	distFS, err := fs.Sub(static.Frontend, "dist")
	if err != nil {
		slog.Error("failed to create sub filesystem", "error", err)
		os.Exit(1)
	}
	fileServer := http.FileServer(http.FS(distFS))

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		f, err := distFS.Open(strings.TrimPrefix(path, "/"))
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for client-side routing
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}
}
