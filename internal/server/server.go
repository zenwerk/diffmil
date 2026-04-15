package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/bluekeyes/go-gitdiff/gitdiff"
	"github.com/zenwerk/diffmil/internal/diff"
	gitcmd "github.com/zenwerk/diffmil/internal/git"
	"github.com/zenwerk/diffmil/internal/static"
)

// Config holds server configuration.
type Config struct {
	// RepoDir is the git repository path. Empty if running in stdin mode.
	RepoDir string
	// InitialDiff is the diff data parsed at startup (for stdin mode or default view).
	InitialDiff *diff.DiffResponse
}

// New creates an HTTP handler that serves the diff API and embedded SPA.
func New(cfg Config) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /_/api/diff", handleDiff(cfg))
	mux.HandleFunc("GET /_/api/commits", handleCommits(cfg))
	mux.HandleFunc("GET /", handleSPA())

	return mux
}

func handleDiff(cfg Config) http.HandlerFunc {
	// Pre-marshal the initial diff for the default case
	initialData, err := json.Marshal(cfg.InitialDiff)
	if err != nil {
		slog.Error("failed to marshal diff response", "error", err)
		os.Exit(1)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		commitHash := r.URL.Query().Get("commit")
		if commitHash == "" || cfg.RepoDir == "" {
			w.Write(initialData)
			return
		}

		// Fetch diff for a specific commit on demand
		reader, err := gitcmd.DiffShow(context.Background(), cfg.RepoDir, commitHash)
		if err != nil {
			http.Error(w, `{"error":"failed to get diff for commit"}`, http.StatusInternalServerError)
			return
		}

		files, _, err := gitdiff.Parse(reader)
		if err != nil {
			http.Error(w, `{"error":"failed to parse diff"}`, http.StatusInternalServerError)
			return
		}

		resp := diff.FromGitDiff(files)
		json.NewEncoder(w).Encode(resp)
	}
}

func handleCommits(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if cfg.RepoDir == "" {
			w.Write([]byte("[]"))
			return
		}

		commits, err := gitcmd.Log(context.Background(), cfg.RepoDir, 50)
		if err != nil {
			http.Error(w, `{"error":"failed to get commits"}`, http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(commits)
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
