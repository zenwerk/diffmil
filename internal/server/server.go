package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

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

// State holds mutable server state protected by a mutex.
type State struct {
	mu          sync.RWMutex
	currentDiff *diff.DiffResponse
	repoDir     string

	subMu       sync.RWMutex
	subscribers map[chan string]struct{}

	shutdownCh chan struct{}
	restartCh  chan struct{}
}

// ShutdownCh returns a channel that is closed when a shutdown is requested.
func (s *State) ShutdownCh() <-chan struct{} { return s.shutdownCh }

// RestartCh returns a channel that is closed when a restart is requested.
func (s *State) RestartCh() <-chan struct{} { return s.restartCh }

func newState(cfg Config) *State {
	return &State{
		currentDiff: cfg.InitialDiff,
		repoDir:     cfg.RepoDir,
		subscribers: make(map[chan string]struct{}),
		shutdownCh:  make(chan struct{}),
		restartCh:   make(chan struct{}),
	}
}

// UpdateDiff replaces the current diff and notifies all SSE subscribers.
func (s *State) UpdateDiff(resp *diff.DiffResponse) {
	s.mu.Lock()
	s.currentDiff = resp
	s.mu.Unlock()
	s.notify("update")
}

func (s *State) getDiff() *diff.DiffResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentDiff
}

func (s *State) subscribe() chan string {
	ch := make(chan string, 8)
	s.subMu.Lock()
	s.subscribers[ch] = struct{}{}
	s.subMu.Unlock()
	return ch
}

func (s *State) unsubscribe(ch chan string) {
	s.subMu.Lock()
	delete(s.subscribers, ch)
	s.subMu.Unlock()
	close(ch)
}

func (s *State) notify(event string) {
	s.subMu.RLock()
	defer s.subMu.RUnlock()
	for ch := range s.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// New creates an HTTP handler that serves the diff API and embedded SPA.
// It returns both the handler and the State (for shutdown/restart signaling).
func New(cfg Config) (http.Handler, *State) {
	state := newState(cfg)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /_/api/diff", handleGetDiff(state))
	mux.HandleFunc("POST /_/api/diff", handlePostDiff(state))
	mux.HandleFunc("GET /_/api/commits", handleCommits(state))
	mux.HandleFunc("GET /_/api/status", handleStatus())
	mux.HandleFunc("POST /_/api/shutdown", handleShutdown(state))
	mux.HandleFunc("POST /_/api/restart", handleRestart(state))
	mux.HandleFunc("GET /_/events", handleSSE(state))
	mux.HandleFunc("GET /", handleSPA())

	return mux, state
}

// workingTreeHash is the special hash used for uncommitted changes.
const workingTreeHash = "working"

func handleGetDiff(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		commitHash := r.URL.Query().Get("commit")
		if commitHash == "" || state.repoDir == "" {
			json.NewEncoder(w).Encode(state.getDiff())
			return
		}

		// Handle uncommitted changes
		if commitHash == workingTreeHash {
			reader, err := gitcmd.DiffUncommitted(context.Background(), state.repoDir)
			if err != nil {
				http.Error(w, `{"error":"failed to get uncommitted diff"}`, http.StatusInternalServerError)
				return
			}
			files, _, err := gitdiff.Parse(reader)
			if err != nil {
				http.Error(w, `{"error":"failed to parse diff"}`, http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(diff.FromGitDiff(files))
			return
		}

		// Fetch diff for a specific commit on demand
		reader, err := gitcmd.DiffShow(context.Background(), state.repoDir, commitHash)
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

func handlePostDiff(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var resp diff.DiffResponse
		if err := json.NewDecoder(r.Body).Decode(&resp); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}
		state.UpdateDiff(&resp)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}
}

func handleCommits(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if state.repoDir == "" {
			w.Write([]byte("[]"))
			return
		}

		ctx := context.Background()

		commits, err := gitcmd.Log(ctx, state.repoDir, 50)
		if err != nil {
			http.Error(w, `{"error":"failed to get commits"}`, http.StatusInternalServerError)
			return
		}

		// Prepend uncommitted changes entry if there are any
		if gitcmd.HasUncommittedChanges(ctx, state.repoDir) {
			working := gitcmd.Commit{
				Hash:    workingTreeHash,
				Short:   "working",
				Subject: "Uncommitted changes",
				Author:  "",
				Date:    "",
			}
			commits = append([]gitcmd.Commit{working}, commits...)
		}

		json.NewEncoder(w).Encode(commits)
	}
}

func handleStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"pid":    os.Getpid(),
		})
	}
}

func handleShutdown(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"ok":true}`))
		// Signal shutdown after response is sent
		go func() {
			select {
			case state.shutdownCh <- struct{}{}:
			default:
			}
		}()
	}
}

func handleRestart(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"ok":true}`))
		// Signal restart after response is sent
		go func() {
			select {
			case state.restartCh <- struct{}{}:
			default:
			}
		}()
	}
}

func handleSSE(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		ch := state.subscribe()
		defer state.unsubscribe(ch)

		// Send initial connected event
		w.Write([]byte("event: connected\ndata: {}\n\n"))
		flusher.Flush()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-ch:
				if !ok {
					return
				}
				w.Write([]byte("event: " + event + "\ndata: {}\n\n"))
				flusher.Flush()
			}
		}
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
