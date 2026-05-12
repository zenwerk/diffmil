package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/zenwerk/diffmil/internal/diff"
)

// makeGitRepo initialises an empty git repository in a temp dir and returns its path.
func makeGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		// Avoid GPG signing and other user-config interference.
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=test",
			"GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=test",
			"GIT_COMMITTER_EMAIL=test@example.com",
			"GIT_CONFIG_GLOBAL=/dev/null",
			"GIT_CONFIG_SYSTEM=/dev/null",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# repo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-q", "-m", "initial")
	return dir
}

func newTestServer(t *testing.T, cfg Config) (*httptest.Server, *State) {
	t.Helper()
	handler, state := New(cfg)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv, state
}

func TestListWorkspacesEmptyByDefault(t *testing.T) {
	srv, _ := newTestServer(t, Config{})
	resp, err := http.Get(srv.URL + "/_/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestAddWorkspaceCreatesEntry(t *testing.T) {
	dir := makeGitRepo(t)
	srv, _ := newTestServer(t, Config{})

	body, _ := json.Marshal(map[string]string{"dir": dir})
	resp, err := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("POST status = %d", resp.StatusCode)
	}
	var ws Workspace
	if err := json.NewDecoder(resp.Body).Decode(&ws); err != nil {
		t.Fatal(err)
	}
	if ws.Dir != dir {
		t.Errorf("Dir = %q, want %q", ws.Dir, dir)
	}
	if ws.ID == "" {
		t.Error("ID empty")
	}

	listResp, err := http.Get(srv.URL + "/_/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer listResp.Body.Close()
	var got []Workspace
	if err := json.NewDecoder(listResp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != ws.ID {
		t.Errorf("list = %+v, want one entry with ID %q", got, ws.ID)
	}
}

func TestAddWorkspaceRejectsNonGitRepo(t *testing.T) {
	plain := t.TempDir()
	srv, _ := newTestServer(t, Config{})
	body, _ := json.Marshal(map[string]string{"dir": plain})
	resp, err := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestAddWorkspaceDuplicateIsIdempotent(t *testing.T) {
	dir := makeGitRepo(t)
	srv, _ := newTestServer(t, Config{})
	body, _ := json.Marshal(map[string]string{"dir": dir})

	post := func() Workspace {
		resp, err := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var ws Workspace
		json.NewDecoder(resp.Body).Decode(&ws)
		return ws
	}
	a := post()
	b := post()
	if a.ID != b.ID {
		t.Errorf("expected same ID on duplicate post, got %q vs %q", a.ID, b.ID)
	}

	resp, err := http.Get(srv.URL + "/_/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got []Workspace
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got) != 1 {
		t.Errorf("expected 1 entry, got %d", len(got))
	}
}

func TestInitialRepoDirRegistersWorkspace(t *testing.T) {
	dir := makeGitRepo(t)
	srv, _ := newTestServer(t, Config{RepoDir: dir})
	resp, err := http.Get(srv.URL + "/_/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got []Workspace
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got) != 1 || got[0].Dir != dir {
		t.Errorf("expected initial workspace, got %+v", got)
	}
}

func TestDeleteWorkspace(t *testing.T) {
	a := makeGitRepo(t)
	b := makeGitRepo(t)
	srv, state := newTestServer(t, Config{})

	for _, d := range []string{a, b} {
		body, _ := json.Marshal(map[string]string{"dir": d})
		resp, _ := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
		resp.Body.Close()
	}

	target := state.Workspaces()[0]
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/_/api/workspaces/"+target.ID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("delete status = %d", resp.StatusCode)
	}
	remaining := state.Workspaces()
	if len(remaining) != 1 {
		t.Errorf("expected 1 remaining, got %d", len(remaining))
	}
	if remaining[0].ID == target.ID {
		t.Error("target still present after delete")
	}
}

func TestDeleteLastWorkspaceForbidden(t *testing.T) {
	dir := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: dir})
	only := state.Workspaces()[0]
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/_/api/workspaces/"+only.ID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestPatchWorkspaceLabel(t *testing.T) {
	dir := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: dir})
	ws := state.Workspaces()[0]

	payload, _ := json.Marshal(map[string]string{"label": "custom"})
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/_/api/workspaces/"+ws.ID, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := state.Workspaces()[0].Label; got != "custom" {
		t.Errorf("Label = %q, want %q", got, "custom")
	}
}

func TestPatchWorkspaceRejectsEmptyLabel(t *testing.T) {
	dir := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: dir})
	ws := state.Workspaces()[0]
	payload, _ := json.Marshal(map[string]string{"label": "   "})
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/_/api/workspaces/"+ws.ID, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCommitsWithWorkspaceFilter(t *testing.T) {
	a := makeGitRepo(t)
	b := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: a})
	body, _ := json.Marshal(map[string]string{"dir": b})
	resp, _ := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
	resp.Body.Close()

	wsList := state.Workspaces()
	if len(wsList) != 2 {
		t.Fatalf("got %d workspaces, want 2", len(wsList))
	}

	for _, ws := range wsList {
		resp, err := http.Get(srv.URL + "/_/api/commits?ws=" + ws.ID)
		if err != nil {
			t.Fatal(err)
		}
		var commits []map[string]any
		json.NewDecoder(resp.Body).Decode(&commits)
		resp.Body.Close()
		if len(commits) == 0 {
			t.Errorf("workspace %q: expected at least one commit", ws.Label)
		}
	}
}

func TestDiffSetGetPerWorkspace(t *testing.T) {
	a := makeGitRepo(t)
	b := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: a})
	body, _ := json.Marshal(map[string]string{"dir": b})
	resp, _ := http.Post(srv.URL+"/_/api/workspaces", "application/json", bytes.NewReader(body))
	resp.Body.Close()

	wsList := state.Workspaces()
	wsA, wsB := wsList[0], wsList[1]

	dummyA := &diff.DiffResponse{Files: []diff.DiffFile{{Path: "a.txt"}}}
	dummyB := &diff.DiffResponse{Files: []diff.DiffFile{{Path: "b.txt"}}}
	state.SetDiff(wsA.ID, dummyA)
	state.SetDiff(wsB.ID, dummyB)

	for _, c := range []struct {
		ws       string
		wantPath string
	}{{wsA.ID, "a.txt"}, {wsB.ID, "b.txt"}} {
		resp, err := http.Get(srv.URL + "/_/api/diff?ws=" + c.ws)
		if err != nil {
			t.Fatal(err)
		}
		var got diff.DiffResponse
		json.NewDecoder(resp.Body).Decode(&got)
		resp.Body.Close()
		if len(got.Files) == 0 || got.Files[0].Path != c.wantPath {
			t.Errorf("ws %q: got %+v, want first file %q", c.ws, got.Files, c.wantPath)
		}
	}
}

func TestSSEEventCarriesWorkspaceID(t *testing.T) {
	dir := makeGitRepo(t)
	srv, state := newTestServer(t, Config{RepoDir: dir})
	wsID := state.Workspaces()[0].ID

	resp, err := http.Get(srv.URL + "/_/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Consume the initial "connected" event.
	reader := bufio.NewReader(resp.Body)
	if _, err := readSSEFrame(reader); err != nil {
		t.Fatalf("read initial frame: %v", err)
	}

	// Trigger a commits-changed event from a goroutine.
	go func() {
		time.Sleep(50 * time.Millisecond)
		state.NotifyCommitsChanged(wsID)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		frame, err := readSSEFrame(reader)
		if err != nil {
			t.Fatalf("read frame: %v", err)
		}
		if frame.event != "commits-changed" {
			continue
		}
		if !strings.Contains(frame.data, wsID) {
			t.Errorf("data = %q, want it to contain %q", frame.data, wsID)
		}
		return
	}
	t.Fatal("did not receive commits-changed within deadline")
}

type sseFrame struct {
	event string
	data  string
}

func readSSEFrame(r *bufio.Reader) (sseFrame, error) {
	var frame sseFrame
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return frame, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			return frame, nil
		}
		switch {
		case strings.HasPrefix(line, "event: "):
			frame.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			frame.data = strings.TrimPrefix(line, "data: ")
		}
	}
}

func TestPostDiffRequiresWorkspace(t *testing.T) {
	srv, _ := newTestServer(t, Config{})
	body, _ := json.Marshal(diff.DiffResponse{})
	resp, err := http.Post(srv.URL+"/_/api/diff", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
