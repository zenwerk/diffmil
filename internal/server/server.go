package server

import (
	"encoding/json"
	"io"
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
	RepoDir     string
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

func (s *State) ShutdownCh() <-chan struct{} { return s.shutdownCh }
func (s *State) RestartCh() <-chan struct{}  { return s.restartCh }

func newState(cfg Config) *State {
	return &State{
		currentDiff: cfg.InitialDiff,
		repoDir:     cfg.RepoDir,
		subscribers: make(map[chan string]struct{}),
		shutdownCh:  make(chan struct{}),
		restartCh:   make(chan struct{}),
	}
}

func (s *State) UpdateDiff(resp *diff.DiffResponse) {
	s.mu.Lock()
	s.currentDiff = resp
	s.mu.Unlock()
	s.notify("update")
}

// NotifyCommitsChanged sends a commits-changed event to all SSE subscribers.
func (s *State) NotifyCommitsChanged() {
	s.notify("commits-changed")
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

// New creates an HTTP handler and returns it with the State for shutdown/restart signaling.
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

const workingTreeHash = "working"

// parseDiffFromReader parses a unified diff from a reader into a DiffResponse.
func parseDiffFromReader(r io.Reader) (*diff.DiffResponse, error) {
	files, _, err := gitdiff.Parse(r)
	if err != nil {
		return nil, err
	}
	return diff.FromGitDiff(files), nil
}

func handleGetDiff(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		commitHash := r.URL.Query().Get("commit")
		if commitHash == "" || state.repoDir == "" {
			json.NewEncoder(w).Encode(state.getDiff())
			return
		}

		ctx := r.Context()
		var reader io.Reader
		var err error

		if commitHash == workingTreeHash {
			reader, err = gitcmd.DiffUncommitted(ctx, state.repoDir)
		} else {
			reader, err = gitcmd.DiffShow(ctx, state.repoDir, commitHash)
		}
		if err != nil {
			http.Error(w, `{"error":"failed to get diff"}`, http.StatusInternalServerError)
			return
		}

		resp, err := parseDiffFromReader(reader)
		if err != nil {
			http.Error(w, `{"error":"failed to parse diff"}`, http.StatusInternalServerError)
			return
		}
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

		ctx := r.Context()

		var (
			commits        []gitcmd.Commit
			hasUncommitted bool
			logErr         error
			wg             sync.WaitGroup
		)
		wg.Add(2)
		go func() {
			defer wg.Done()
			commits, logErr = gitcmd.Log(ctx, state.repoDir, 50)
		}()
		go func() {
			defer wg.Done()
			hasUncommitted = gitcmd.HasUncommittedChanges(ctx, state.repoDir)
		}()
		wg.Wait()

		if logErr != nil {
			http.Error(w, `{"error":"failed to get commits"}`, http.StatusInternalServerError)
			return
		}

		if hasUncommitted {
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
			"app":    "diffmil",
			"status": "ok",
			"pid":    os.Getpid(),
		})
	}
}

func handleShutdown(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		w.Write([]byte(`{"ok":true}`))
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

		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}
}
