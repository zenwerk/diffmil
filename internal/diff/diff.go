package diff

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/bluekeyes/go-gitdiff/gitdiff"
)

// DiffResponse is the top-level API response containing all diff files.
type DiffResponse struct {
	Files []DiffFile `json:"files"`
	// Patch holds the full raw unified diff text, kept so it can be handed to
	// @pierre/diffs's parsePatchFiles on the frontend.
	Patch string `json:"patch,omitempty"`
}

// ParsePatch parses a raw unified diff into a DiffResponse, keeping the raw
// text in Patch. Every DiffResponse built from a patch must go through here so
// the "Patch always carries the full raw diff" invariant lives in one place.
func ParsePatch(raw []byte) (*DiffResponse, error) {
	files, _, err := gitdiff.Parse(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	resp := FromGitDiff(files)
	resp.Patch = string(raw)
	return resp, nil
}

// DiffFile represents a single file in the diff.
type DiffFile struct {
	Path      string      `json:"path"`
	OldPath   string      `json:"oldPath,omitempty"`
	Status    string      `json:"status"` // "modified", "added", "deleted", "renamed"
	Additions int         `json:"additions"`
	Deletions int         `json:"deletions"`
	IsBinary  bool        `json:"isBinary,omitempty"`
	Chunks    []DiffChunk `json:"chunks"`
}

// DiffChunk represents a single hunk in the diff.
type DiffChunk struct {
	Header   string     `json:"header"`
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Lines    []DiffLine `json:"lines"`
}

// DiffLine represents a single line in a diff chunk.
type DiffLine struct {
	Type          string `json:"type"` // "add", "delete", "normal"
	Content       string `json:"content"`
	OldLineNumber *int   `json:"oldLineNumber,omitempty"`
	NewLineNumber *int   `json:"newLineNumber,omitempty"`
}

// FromGitDiff converts go-gitdiff parsed files into our API response type.
func FromGitDiff(files []*gitdiff.File) *DiffResponse {
	result := &DiffResponse{
		Files: make([]DiffFile, 0, len(files)),
	}

	for _, f := range files {
		df := convertFile(f)
		result.Files = append(result.Files, df)
	}

	return result
}

func convertFile(f *gitdiff.File) DiffFile {
	df := DiffFile{
		Path:     filePath(f),
		OldPath:  fileOldPath(f),
		Status:   fileStatus(f),
		IsBinary: f.IsBinary,
		Chunks:   make([]DiffChunk, 0, len(f.TextFragments)),
	}

	for _, frag := range f.TextFragments {
		chunk := convertFragment(frag)
		df.Additions += int(frag.LinesAdded)
		df.Deletions += int(frag.LinesDeleted)
		df.Chunks = append(df.Chunks, chunk)
	}

	return df
}

func convertFragment(frag *gitdiff.TextFragment) DiffChunk {
	chunk := DiffChunk{
		Header:   formatHeader(frag),
		OldStart: int(frag.OldPosition),
		OldLines: int(frag.OldLines),
		NewStart: int(frag.NewPosition),
		NewLines: int(frag.NewLines),
		Lines:    make([]DiffLine, 0, len(frag.Lines)),
	}

	oldLine := int(frag.OldPosition)
	newLine := int(frag.NewPosition)

	for _, line := range frag.Lines {
		dl := DiffLine{
			Content: strings.TrimSuffix(line.Line, "\n"),
		}

		switch line.Op {
		case gitdiff.OpAdd:
			dl.Type = "add"
			dl.NewLineNumber = intPtr(newLine)
			newLine++
		case gitdiff.OpDelete:
			dl.Type = "delete"
			dl.OldLineNumber = intPtr(oldLine)
			oldLine++
		default: // OpContext
			dl.Type = "normal"
			dl.OldLineNumber = intPtr(oldLine)
			dl.NewLineNumber = intPtr(newLine)
			oldLine++
			newLine++
		}

		chunk.Lines = append(chunk.Lines, dl)
	}

	return chunk
}

func filePath(f *gitdiff.File) string {
	if f.NewName != "" {
		return f.NewName
	}
	return f.OldName
}

func fileOldPath(f *gitdiff.File) string {
	if f.IsRename || f.IsCopy {
		return f.OldName
	}
	return ""
}

func fileStatus(f *gitdiff.File) string {
	switch {
	case f.IsNew:
		return "added"
	case f.IsDelete:
		return "deleted"
	case f.IsRename:
		return "renamed"
	default:
		return "modified"
	}
}

func formatHeader(frag *gitdiff.TextFragment) string {
	comment := ""
	if frag.Comment != "" {
		comment = " " + frag.Comment
	}
	return strings.TrimRight(
		strings.Join([]string{
			"@@",
			formatRange("-", frag.OldPosition, frag.OldLines),
			formatRange("+", frag.NewPosition, frag.NewLines),
			"@@" + comment,
		}, " "),
		" ",
	)
}

func formatRange(prefix string, start, count int64) string {
	if count == 1 {
		return fmt.Sprintf("%s%d", prefix, start)
	}
	return fmt.Sprintf("%s%d,%d", prefix, start, count)
}

func intPtr(n int) *int {
	return &n
}
