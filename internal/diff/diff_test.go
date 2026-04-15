package diff

import (
	"fmt"
	"strings"
	"testing"

	"github.com/bluekeyes/go-gitdiff/gitdiff"
)

const testDiffModified = `diff --git a/hello.go b/hello.go
index 1234567..abcdefg 100644
--- a/hello.go
+++ b/hello.go
@@ -1,5 +1,5 @@
 package main

 func main() {
-	println("hello")
+	println("world")
 }
`

const testDiffAdded = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`

const testDiffDeleted = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 1234567..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-goodbye
-world
`

const testDiffRenamed = `diff --git a/old_name.txt b/new_name.txt
similarity index 100%
rename from old_name.txt
rename to new_name.txt
`

func TestFromGitDiff_Modified(t *testing.T) {
	files, _, err := gitdiff.Parse(strings.NewReader(testDiffModified))
	if err != nil {
		t.Fatal(err)
	}

	resp := FromGitDiff(files)

	if len(resp.Files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(resp.Files))
	}

	f := resp.Files[0]
	if f.Path != "hello.go" {
		t.Errorf("expected path 'hello.go', got %q", f.Path)
	}
	if f.Status != "modified" {
		t.Errorf("expected status 'modified', got %q", f.Status)
	}
	if f.Additions != 1 {
		t.Errorf("expected 1 addition, got %d", f.Additions)
	}
	if f.Deletions != 1 {
		t.Errorf("expected 1 deletion, got %d", f.Deletions)
	}
	if len(f.Chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(f.Chunks))
	}

	chunk := f.Chunks[0]
	if chunk.OldStart != 1 || chunk.NewStart != 1 {
		t.Errorf("expected chunk start (1,1), got (%d,%d)", chunk.OldStart, chunk.NewStart)
	}

	// Verify line types and numbers
	var adds, deletes, normals int
	for _, line := range chunk.Lines {
		switch line.Type {
		case "add":
			adds++
			if line.NewLineNumber == nil {
				t.Error("add line should have NewLineNumber")
			}
			if line.OldLineNumber != nil {
				t.Error("add line should not have OldLineNumber")
			}
		case "delete":
			deletes++
			if line.OldLineNumber == nil {
				t.Error("delete line should have OldLineNumber")
			}
			if line.NewLineNumber != nil {
				t.Error("delete line should not have NewLineNumber")
			}
		case "normal":
			normals++
			if line.OldLineNumber == nil || line.NewLineNumber == nil {
				t.Error("normal line should have both line numbers")
			}
		}
	}
	if adds != 1 || deletes != 1 || normals != 4 {
		t.Errorf("expected 1 add, 1 delete, 4 normal; got %d add, %d delete, %d normal", adds, deletes, normals)
	}
}

func TestFromGitDiff_Added(t *testing.T) {
	files, _, err := gitdiff.Parse(strings.NewReader(testDiffAdded))
	if err != nil {
		t.Fatal(err)
	}

	resp := FromGitDiff(files)
	f := resp.Files[0]

	if f.Path != "newfile.txt" {
		t.Errorf("expected path 'newfile.txt', got %q", f.Path)
	}
	if f.Status != "added" {
		t.Errorf("expected status 'added', got %q", f.Status)
	}
	if f.Additions != 3 {
		t.Errorf("expected 3 additions, got %d", f.Additions)
	}
	if f.Deletions != 0 {
		t.Errorf("expected 0 deletions, got %d", f.Deletions)
	}
}

func TestFromGitDiff_Deleted(t *testing.T) {
	files, _, err := gitdiff.Parse(strings.NewReader(testDiffDeleted))
	if err != nil {
		t.Fatal(err)
	}

	resp := FromGitDiff(files)
	f := resp.Files[0]

	if f.Path != "old.txt" {
		t.Errorf("expected path 'old.txt', got %q", f.Path)
	}
	if f.Status != "deleted" {
		t.Errorf("expected status 'deleted', got %q", f.Status)
	}
	if f.Additions != 0 {
		t.Errorf("expected 0 additions, got %d", f.Additions)
	}
	if f.Deletions != 2 {
		t.Errorf("expected 2 deletions, got %d", f.Deletions)
	}
}

func TestFromGitDiff_Renamed(t *testing.T) {
	files, _, err := gitdiff.Parse(strings.NewReader(testDiffRenamed))
	if err != nil {
		t.Fatal(err)
	}

	resp := FromGitDiff(files)
	f := resp.Files[0]

	if f.Path != "new_name.txt" {
		t.Errorf("expected path 'new_name.txt', got %q", f.Path)
	}
	if f.OldPath != "old_name.txt" {
		t.Errorf("expected oldPath 'old_name.txt', got %q", f.OldPath)
	}
	if f.Status != "renamed" {
		t.Errorf("expected status 'renamed', got %q", f.Status)
	}
}

func TestFromGitDiff_Empty(t *testing.T) {
	resp := FromGitDiff(nil)
	if len(resp.Files) != 0 {
		t.Errorf("expected 0 files, got %d", len(resp.Files))
	}
}

func TestFromGitDiff_LineNumbers(t *testing.T) {
	files, _, err := gitdiff.Parse(strings.NewReader(testDiffModified))
	if err != nil {
		t.Fatal(err)
	}

	resp := FromGitDiff(files)
	lines := resp.Files[0].Chunks[0].Lines

	// Lines: normal(1,1), normal(2,2), normal(3,3), delete(4,-), add(-,4), normal(5,5)
	expectations := []struct {
		typ    string
		oldNum *int
		newNum *int
	}{
		{"normal", intPtr(1), intPtr(1)},
		{"normal", intPtr(2), intPtr(2)},
		{"normal", intPtr(3), intPtr(3)},
		{"delete", intPtr(4), nil},
		{"add", nil, intPtr(4)},
		{"normal", intPtr(5), intPtr(5)},
	}

	if len(lines) != len(expectations) {
		t.Fatalf("expected %d lines, got %d", len(expectations), len(lines))
	}

	for i, exp := range expectations {
		line := lines[i]
		if line.Type != exp.typ {
			t.Errorf("line %d: expected type %q, got %q", i, exp.typ, line.Type)
		}
		if !intPtrEqual(line.OldLineNumber, exp.oldNum) {
			t.Errorf("line %d: expected old=%v, got old=%v", i, ptrStr(exp.oldNum), ptrStr(line.OldLineNumber))
		}
		if !intPtrEqual(line.NewLineNumber, exp.newNum) {
			t.Errorf("line %d: expected new=%v, got new=%v", i, ptrStr(exp.newNum), ptrStr(line.NewLineNumber))
		}
	}
}

func intPtrEqual(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func ptrStr(p *int) string {
	if p == nil {
		return "nil"
	}
	return fmt.Sprintf("%d", *p)
}
