import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { PierreDiffViewer } from "./PierreDiffViewer";
import { ThemeProvider } from "../hooks/useTheme";
import { buildFileDiffMap } from "../utils/pierrePatch";
import type { CommentThread, DiffFile } from "../types";

// @pierre/diffs renders into a custom element and measures annotation heights
// with ResizeObserver, neither of which jsdom implements. These shims are the
// minimum needed to mount; they do not emulate layout, so these tests assert
// only that annotation content is projected into the right light-DOM slot —
// never on geometry, positioning, or hover behavior (verify those in a browser).
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // ThemeProvider resolves the "system" theme through matchMedia.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const PATCH = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -10,3 +10,4 @@
 ctx
-gone
+new1
+new2
 ctx2
`;

const file: DiffFile = {
  path: "a.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  chunks: [
    {
      header: "@@ -10,3 +10,4 @@",
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 4,
      lines: [
        { type: "normal", content: "ctx", oldLineNumber: 10, newLineNumber: 10 },
        { type: "delete", content: "gone", oldLineNumber: 11 },
        { type: "add", content: "new1", newLineNumber: 11 },
        { type: "add", content: "new2", newLineNumber: 12 },
        { type: "normal", content: "ctx2", oldLineNumber: 12, newLineNumber: 13 },
      ],
    },
  ],
};

function mkThread(
  id: string,
  line: number,
  body: string,
  side: "old" | "new" = "new",
): CommentThread {
  return {
    id,
    commitHash: "abc123",
    filePath: "a.ts",
    side,
    line,
    codeSnapshot: "new1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    messages: [
      {
        id: `${id}-m`,
        body,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    ],
  };
}

function renderViewer(threads: CommentThread[]) {
  const fileDiff = buildFileDiffMap(PATCH).get("a.ts");
  if (!fileDiff) throw new Error("test patch failed to parse");
  return render(
    <ThemeProvider>
      <PierreDiffViewer
        file={file}
        fileDiff={fileDiff}
        metrics={{
          hunkLineCount: 50,
          lineHeight: 21,
          diffHeaderHeight: 37,
          spacing: 8,
        }}
        viewMode="unified"
        collapsed={false}
        onToggleCollapsed={() => {}}
        threads={threads}
        onAddComment={vi.fn()}
        onUpdateComment={vi.fn()}
        onRemoveComment={vi.fn()}
      />
    </ThemeProvider>,
  );
}

// Annotation slots are named `annotation-<side>-<lineNumber>` by the library,
// so querying by slot name asserts the side mapping and line anchoring that
// pierreAnnotations computes, end to end through the React binding.
function slot(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[slot="${name}"]`);
}

describe("PierreDiffViewer comments", () => {
  it("projects a thread's card into the annotation slot for its side and line", () => {
    const { container } = renderViewer([mkThread("t1", 11, "first comment")]);
    const annotation = slot(container, "annotation-additions-11");
    expect(annotation).not.toBeNull();
    expect(annotation).toHaveTextContent("first comment");
    // The card renders its own line label from the thread, so a mismatch here
    // would mean the slot and the card disagree about the target line.
    expect(annotation).toHaveTextContent("a.ts:L11");
  });

  it("maps an old-side thread onto the deletions slot", () => {
    const { container } = renderViewer([mkThread("t1", 11, "on the old side", "old")]);
    expect(slot(container, "annotation-deletions-11")).toHaveTextContent("on the old side");
    expect(slot(container, "annotation-additions-11")).toBeNull();
  });

  it("renders every thread anchored on the same line in one slot", () => {
    const { container } = renderViewer([
      mkThread("t1", 11, "first comment"),
      mkThread("t2", 11, "second comment"),
    ]);
    const annotation = slot(container, "annotation-additions-11");
    // Grouping must not drop a card: the library renders one slot per line.
    expect(annotation).toHaveTextContent("first comment");
    expect(annotation).toHaveTextContent("second comment");
  });

  it("renders the gutter utility button", () => {
    const { container } = renderViewer([]);
    const gutter = slot(container, "gutter-utility-slot");
    expect(gutter).not.toBeNull();
    expect(gutter?.querySelector("button")).not.toBeNull();
  });

  it("shows the thread count in the file header", () => {
    const { container } = renderViewer([mkThread("t1", 11, "first comment")]);
    expect(container.textContent).toContain("💬 1");
  });

  it("renders no annotation slots when there are no comments", () => {
    const { container } = renderViewer([]);
    expect(container.querySelector('[slot^="annotation-"]')).toBeNull();
  });
});
