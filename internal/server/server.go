package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	subscribers map[chan sseEvent]struct{}

	shutdownCh chan struct{}
	restartCh  chan struct{}

	// WorkspaceAdded is invoked synchronously when a new workspace is registered.
	// Callers can use it to start per-workspace background work (e.g. a git watcher).
	WorkspaceAdded func(ws *Workspace)

	// WorkspaceRemoved is invoked synchronously when a workspace is unregistered.
	// Callers can use it to stop per-workspace background work.
	WorkspaceRemoved func(id string)

	// dirty is signalled (non-blocking) whenever the workspace list mutates.
	// Callers can subscribe via DirtyCh() to persist the latest snapshot.
	dirty chan struct{}
}

// DirtyCh returns a channel that receives a non-blocking signal whenever the
// workspace list changes. The channel buffers a single pending notification.
func (s *State) DirtyCh() <-chan struct{} { return s.dirty }

func (s *State) ShutdownCh() <-chan struct{} { return s.shutdownCh }
func (s *State) RestartCh() <-chan struct{}  { return s.restartCh }

// sseEvent represents a single Server-Sent Event payload delivered to clients.
type sseEvent struct {
	Name string
	Data string
}

func newState(cfg Config) *State {
	s := &State{
		diffs:       make(map[string]*diff.DiffResponse),
		subscribers: make(map[chan sseEvent]struct{}),
		shutdownCh:  make(chan struct{}),
		restartCh:   make(chan struct{}),
		dirty:       make(chan struct{}, 1),
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

// AddWorkspace registers a workspace for the given absolute directory.
// If a workspace for that directory already exists it is returned without modification.
// The bool return value is true when a new workspace was added.
func (s *State) AddWorkspace(dir string) (*Workspace, bool) {
	s.mu.Lock()
	for _, w := range s.workspaces {
		if w.Dir == dir {
			existing := *w
			s.mu.Unlock()
			return &existing, false
		}
	}
	ws := newWorkspace(dir)
	s.workspaces = append(s.workspaces, &ws)
	s.mu.Unlock()

	if s.WorkspaceAdded != nil {
		s.WorkspaceAdded(&ws)
	}
	s.notify(sseEvent{Name: "workspaces-changed", Data: "{}"})
	s.markDirty()
	return &ws, true
}

// RemoveResult describes the outcome of a RemoveWorkspace call.
type RemoveResult int

const (
	// RemoveOK indicates the workspace was removed.
	RemoveOK RemoveResult = iota
	// RemoveNotFound indicates no workspace with that ID exists.
	RemoveNotFound
	// RemoveLastWorkspace indicates the workspace is the only one and was not removed.
	RemoveLastWorkspace
)

// RemoveWorkspace removes the workspace with the given ID. The last workspace
// cannot be removed; the check is performed under the same lock as the mutation
// to avoid a TOCTOU race with concurrent deletes.
func (s *State) RemoveWorkspace(id string) RemoveResult {
	s.mu.Lock()
	idx := -1
	for i, w := range s.workspaces {
		if w.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		s.mu.Unlock()
		return RemoveNotFound
	}
	if len(s.workspaces) <= 1 {
		s.mu.Unlock()
		return RemoveLastWorkspace
	}
	s.workspaces = append(s.workspaces[:idx], s.workspaces[idx+1:]...)
	delete(s.diffs, id)
	s.mu.Unlock()

	if s.WorkspaceRemoved != nil {
		s.WorkspaceRemoved(id)
	}
	s.notify(sseEvent{Name: "workspaces-changed", Data: "{}"})
	s.markDirty()
	return RemoveOK
}

// UpdateWorkspaceLabel changes the user-facing label of a workspace.
// Returns the updated workspace or nil when the ID is unknown.
func (s *State) UpdateWorkspaceLabel(id, label string) *Workspace {
	s.mu.Lock()
	var updated *Workspace
	for _, w := range s.workspaces {
		if w.ID == id {
			w.Label = label
			copy := *w
			updated = &copy
			break
		}
	}
	s.mu.Unlock()
	if updated == nil {
		return nil
	}
	s.notify(sseEvent{Name: "workspaces-changed", Data: "{}"})
	s.markDirty()
	return updated
}

// markDirty sends a non-blocking signal on the dirty channel.
func (s *State) markDirty() {
	select {
	case s.dirty <- struct{}{}:
	default:
	}
}

// SetDiff replaces the cached diff for the given workspace ID.
func (s *State) SetDiff(wsID string, resp *diff.DiffResponse) {
	s.mu.Lock()
	s.diffs[wsID] = resp
	s.mu.Unlock()
	s.notify(workspaceEvent("update", wsID))
}

// NotifyCommitsChanged sends a commits-changed event scoped to a workspace.
// Pass an empty string to broadcast (used only as a legacy fallback).
func (s *State) NotifyCommitsChanged(wsID string) {
	s.notify(workspaceEvent("commits-changed", wsID))
}

// workspaceEvent builds an SSE event with a JSON payload containing the workspace ID.
func workspaceEvent(name, wsID string) sseEvent {
	if wsID == "" {
		return sseEvent{Name: name, Data: "{}"}
	}
	data, err := json.Marshal(map[string]string{"workspaceId": wsID})
	if err != nil {
		return sseEvent{Name: name, Data: "{}"}
	}
	return sseEvent{Name: name, Data: string(data)}
}

func (s *State) getDiff(wsID string) *diff.DiffResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if wsID == "" && len(s.workspaces) > 0 {
		wsID = s.workspaces[0].ID
	}
	return s.diffs[wsID]
}

func (s *State) subscribe() chan sseEvent {
	ch := make(chan sseEvent, 16)
	s.subMu.Lock()
	s.subscribers[ch] = struct{}{}
	s.subMu.Unlock()
	return ch
}

func (s *State) unsubscribe(ch chan sseEvent) {
	s.subMu.Lock()
	delete(s.subscribers, ch)
	s.subMu.Unlock()
	close(ch)
}

func (s *State) notify(event sseEvent) {
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
	mux.HandleFunc("GET /_/api/blob-lines", handleBlobLines(state))
	mux.HandleFunc("GET /_/api/file", handleFile(state))
	mux.HandleFunc("GET /_/api/commits", handleCommits(state))
	mux.HandleFunc("GET /_/api/branch", handleBranch(state))
	mux.HandleFunc("GET /_/api/workspaces", handleListWorkspaces(state))
	mux.HandleFunc("POST /_/api/workspaces", handleAddWorkspace(state))
	mux.HandleFunc("DELETE /_/api/workspaces/{id}", handleRemoveWorkspace(state))
	mux.HandleFunc("PATCH /_/api/workspaces/{id}", handlePatchWorkspace(state))
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
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	files, _, err := gitdiff.Parse(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	resp := diff.FromGitDiff(files)
	resp.Patch = string(raw)
	return resp, nil
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

func handleBranch(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ws := state.findWorkspace(r.URL.Query().Get("ws"))
		if ws == nil || ws.Dir == "" {
			w.Write([]byte(`{"branch":""}`))
			return
		}

		branch, err := gitcmd.CurrentBranch(r.Context(), ws.Dir)
		if err != nil {
			branch = ""
		}
		json.NewEncoder(w).Encode(map[string]string{"branch": branch})
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

func handleRemoveWorkspace(state *State) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
			return
		}
		switch state.RemoveWorkspace(id) {
		case RemoveOK:
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"ok":true}`))
		case RemoveLastWorkspace:
			http.Error(w, `{"error":"cannot remove the last workspace"}`, http.StatusBadRequest)
		case RemoveNotFound:
			http.Error(w, `{"error":"workspace not found"}`, http.StatusNotFound)
		}
	}
}

func handlePatchWorkspace(state *State) http.HandlerFunc {
	type request struct {
		Label string `json:"label"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, `{"error":"id is required"}`, http.StatusBadRequest)
			return
		}
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(req.Label) == "" {
			http.Error(w, `{"error":"label is required"}`, http.StatusBadRequest)
			return
		}
		ws := state.UpdateWorkspaceLabel(id, req.Label)
		if ws == nil {
			http.Error(w, `{"error":"workspace not found"}`, http.StatusNotFound)
			return
		}
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
				data := event.Data
				if data == "" {
					data = "{}"
				}
				w.Write([]byte("event: " + event.Name + "\ndata: " + data + "\n\n"))
				flusher.Flush()
			}
		}
	}
}

// handleBlobLines returns a slice of lines from a file at a given commit,
// used by the frontend to expand context above/below a diff hunk.
func handleBlobLines(state *State) http.HandlerFunc {
	type response struct {
		Lines      []string `json:"lines"`
		TotalLines int      `json:"totalLines"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		q := r.URL.Query()

		ws := state.findWorkspace(q.Get("ws"))
		if ws == nil || ws.Dir == "" {
			http.Error(w, `{"error":"no workspace"}`, http.StatusBadRequest)
			return
		}

		path := q.Get("path")
		if !isSafeRelPath(path) {
			http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
			return
		}

		side := q.Get("side")
		if side != "old" && side != "new" {
			http.Error(w, `{"error":"side must be old or new"}`, http.StatusBadRequest)
			return
		}

		start, err1 := strconv.Atoi(q.Get("start"))
		end, err2 := strconv.Atoi(q.Get("end"))
		if err1 != nil || err2 != nil || start < 1 || end < start {
			http.Error(w, `{"error":"invalid range"}`, http.StatusBadRequest)
			return
		}

		commit := q.Get("commit")

		blob, err := readBlobForSide(r.Context(), ws.Dir, commit, side, path)
		if err != nil {
			http.Error(w, `{"error":"failed to read blob"}`, http.StatusInternalServerError)
			return
		}
		if blob == nil {
			// Not available (e.g. added/removed file on the requested side, or
			// stdin-supplied diff whose path isn't in this workspace's git).
			json.NewEncoder(w).Encode(response{Lines: []string{}, TotalLines: 0})
			return
		}

		all := splitLines(blob)
		total := len(all)
		if start > total {
			json.NewEncoder(w).Encode(response{Lines: []string{}, TotalLines: total})
			return
		}
		if end > total {
			end = total
		}
		// Slice is [start-1, end) in 0-based indexing.
		json.NewEncoder(w).Encode(response{Lines: all[start-1 : end], TotalLines: total})
	}
}

// maxFileContentsSize is a hard safety cap on the blob size served by
// handleFile. It is deliberately generous: @pierre/diffs stops tokenizing a
// file after ~100k characters, so anything beyond a few MB adds latency and
// memory overhead without improving what the frontend can render.
const maxFileContentsSize = 5 * 1024 * 1024 // 5MB

// handleFile returns the full contents of a file at a given commit/side,
// used by the frontend's @pierre/diffs integration which needs whole-file
// text (rather than a line range) to tokenize and render a diff.
func handleFile(state *State) http.HandlerFunc {
	type response struct {
		Contents *string `json:"contents"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		q := r.URL.Query()

		ws := state.findWorkspace(q.Get("ws"))
		if ws == nil || ws.Dir == "" {
			http.Error(w, `{"error":"no workspace"}`, http.StatusBadRequest)
			return
		}

		path := q.Get("path")
		if !isSafeRelPath(path) {
			http.Error(w, `{"error":"invalid path"}`, http.StatusBadRequest)
			return
		}

		side := q.Get("side")
		if side != "old" && side != "new" {
			http.Error(w, `{"error":"side must be old or new"}`, http.StatusBadRequest)
			return
		}

		commit := q.Get("commit")

		blob, err := readBlobForSide(r.Context(), ws.Dir, commit, side, path)
		if err != nil {
			http.Error(w, `{"error":"failed to read blob"}`, http.StatusInternalServerError)
			return
		}
		if blob == nil || len(blob) > maxFileContentsSize {
			json.NewEncoder(w).Encode(response{Contents: nil})
			return
		}

		contents := string(blob)
		json.NewEncoder(w).Encode(response{Contents: &contents})
	}
}

// readBlobForSide resolves the appropriate blob for the requested diff side
// and commit, returning nil when the blob isn't available.
func readBlobForSide(ctx context.Context, dir, commit, side, path string) ([]byte, error) {
	// Treat empty / "working" commit as "current working tree vs HEAD".
	if commit == "" || commit == workingTreeHash {
		if side == "new" {
			b, err := os.ReadFile(filepath.Join(dir, path))
			if err != nil {
				if os.IsNotExist(err) {
					return nil, nil
				}
				return nil, err
			}
			return b, nil
		}
		return gitcmd.ShowBlob(ctx, dir, "HEAD", path)
	}

	ref := commit
	if side == "old" {
		ref = commit + "^"
	}
	return gitcmd.ShowBlob(ctx, dir, ref, path)
}

// isSafeRelPath rejects absolute paths and paths containing ".." segments so
// the blob-lines endpoint cannot read arbitrary files outside the workspace.
func isSafeRelPath(p string) bool {
	if p == "" || filepath.IsAbs(p) {
		return false
	}
	cleaned := filepath.Clean(p)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return false
	}
	for _, part := range strings.Split(cleaned, string(filepath.Separator)) {
		if part == ".." {
			return false
		}
	}
	return true
}

// splitLines splits text on "\n" without producing a trailing empty element
// when the input ends with a newline — matching how unified diffs index lines.
func splitLines(b []byte) []string {
	s := string(b)
	if s == "" {
		return nil
	}
	if strings.HasSuffix(s, "\n") {
		s = s[:len(s)-1]
	}
	return strings.Split(s, "\n")
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
