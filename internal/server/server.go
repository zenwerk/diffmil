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
	mu sync.RWMutex
	// workspaces is the ordered list of registered workspaces.
	// The order reflects the addition order; the first one is treated as the default.
	workspaces []*Workspace
	// diffs holds the latest diff response per workspace.
	diffs map[string]*diff.DiffResponse

	subMu       sync.RWMutex
	subscribers map[chan string]struct{}

	shutdownCh chan struct{}
	restartCh  chan struct{}

	// WorkspaceAdded is invoked synchronously when a new workspace is registered.
	// Callers can use it to start per-workspace background work (e.g. a git watcher).
	WorkspaceAdded func(ws *Workspace)
}

func (s *State) ShutdownCh() <-chan struct{} { return s.shutdownCh }
func (s *State) RestartCh() <-chan struct{}  { return s.restartCh }

func newState(cfg Config) *State {
	s := &State{
		diffs:       make(map[string]*diff.DiffResponse),
		subscribers: make(map[chan string]struct{}),
		shutdownCh:  make(chan struct{}),
		restartCh:   make(chan struct{}),
	}
	if cfg.RepoDir != "" {
		ws := newWorkspace(cfg.RepoDir)
		s.workspaces = append(s.workspaces, &ws)
		if cfg.InitialDiff != nil {
			s.diffs[ws.ID] = cfg.InitialDiff
		}
	}
	return s
}

// Workspaces returns a snapshot of the current workspace list.
func (s *State) Workspaces() []Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Workspace, 0, len(s.workspaces))
	for _, w := range s.workspaces {
		out = append(out, *w)
	}
	return out
}

// findWorkspace returns the workspace for the given ID, or nil if not found.
// If id is empty, the first workspace (default) is returned when available.
func (s *State) findWorkspace(id string) *Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if id == "" {
		if len(s.workspaces) > 0 {
			return s.workspaces[0]
		}
		return nil
	}
	for _, w := range s.workspaces {
		if w.ID == id {
			return w
		}
	}
	return nil
}

// findWorkspaceByDir locates a workspace by its absolute directory path.
func (s *State) findWorkspaceByDir(dir string) *Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, w := range s.workspaces {
		if w.Dir == dir {
			return w
		}
	}
	return nil
}

// AddWorkspace registers a workspace for the given absolute directory.
// If a workspace for that directory already exists it is returned without modification.
// The bool return value is true when a new workspace was added.
func (s *State) AddWorkspace(dir string) (*Workspace, bool) {
	if existing := s.findWorkspaceByDir(dir); existing != nil {
		return existing, false
	}
	ws := newWorkspace(dir)
	s.mu.Lock()
	s.workspaces = append(s.workspaces, &ws)
	s.mu.Unlock()
	if s.WorkspaceAdded != nil {
		s.WorkspaceAdded(&ws)
	}
	s.notify("workspaces-changed")
	return &ws, true
}

// SetDiff replaces the cached diff for the given workspace ID.
func (s *State) SetDiff(wsID string, resp *diff.DiffResponse) {
	s.mu.Lock()
	s.diffs[wsID] = resp
	s.mu.Unlock()
	s.notify("update")
}

// NotifyCommitsChanged sends a commits-changed event to all SSE subscribers.
func (s *State) NotifyCommitsChanged() {
	s.notify("commits-changed")
}

func (s *State) getDiff(wsID string) *diff.DiffResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if wsID == "" && len(s.workspaces) > 0 {
		wsID = s.workspaces[0].ID
	}
	return s.diffs[wsID]
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
	mux.HandleFunc("GET /_/api/workspaces", handleListWorkspaces(state))
	mux.HandleFunc("POST /_/api/workspaces", handleAddWorkspace(state))
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

		wsID := r.URL.Query().Get("ws")
		ws := state.findWorkspace(wsID)

		commitHash := r.URL.Query().Get("commit")
		if commitHash == "" || ws == nil {
			if ws != nil {
				json.NewEncoder(w).Encode(state.getDiff(ws.ID))
				return
			}
			json.NewEncoder(w).Encode(state.getDiff(""))
			return
		}

		ctx := r.Context()
		var reader io.Reader
		var err error

		if commitHash == workingTreeHash {
			reader, err = gitcmd.DiffUncommitted(ctx, ws.Dir)
		} else {
			reader, err = gitcmd.DiffShow(ctx, ws.Dir, commitHash)
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
		wsID := r.URL.Query().Get("ws")
		ws := state.findWorkspace(wsID)
		if ws == nil {
			http.Error(w, `{"error":"no workspace"}`, http.StatusBadRequest)
			return
		}
		state.SetDiff(ws.ID, &resp)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}
}

func handleCommits(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		wsID := r.URL.Query().Get("ws")
		ws := state.findWorkspace(wsID)
		if ws == nil || ws.Dir == "" {
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
			commits, logErr = gitcmd.Log(ctx, ws.Dir, 50)
		}()
		go func() {
			defer wg.Done()
			hasUncommitted = gitcmd.HasUncommittedChanges(ctx, ws.Dir)
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

func handleListWorkspaces(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(state.Workspaces())
	}
}

func handleAddWorkspace(state *State) http.HandlerFunc {
	type request struct {
		Dir string `json:"dir"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}
		if req.Dir == "" {
			http.Error(w, `{"error":"dir is required"}`, http.StatusBadRequest)
			return
		}
		if !gitcmd.IsGitRepo(req.Dir) {
			http.Error(w, `{"error":"not a git repository"}`, http.StatusBadRequest)
			return
		}
		ws, _ := state.AddWorkspace(req.Dir)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ws)
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
