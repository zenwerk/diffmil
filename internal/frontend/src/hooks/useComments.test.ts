import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useComments,
  listCommitsWithComments,
  loadAllWorkspaceThreads,
  clearAllWorkspaceComments,
  pruneOrphanWorkspaceComments,
} from "./useComments";
import type { CommentThread } from "../types";

function makeThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: "x",
    filePath: "a",
    line: 1,
    side: "new",
    codeSnapshot: "",
    commitHash: "h",
    createdAt: "",
    updatedAt: "",
    messages: [{ id: "m", body: "b", createdAt: "", updatedAt: "" }],
    ...overrides,
  };
}

const addOne = (
  result: { current: ReturnType<typeof useComments> },
  body: string,
  overrides: Partial<{
    filePath: string;
    line: number;
    endLine: number;
    side: "old" | "new";
  }> = {},
) => {
  act(() => {
    result.current.addThread({
      filePath: overrides.filePath ?? "src/foo.ts",
      side: overrides.side ?? "new",
      line: overrides.line ?? 1,
      endLine: overrides.endLine,
      body,
      codeSnapshot: "code",
    });
  });
};

describe("useComments", () => {
  it("adds a thread and persists to localStorage", () => {
    const { result } = renderHook(() => useComments("ws1", "commit-a"));
    addOne(result, "first comment");
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].messages[0].body).toBe("first comment");
    expect(localStorage.getItem("diffmil.comments.ws1.commit-a")).toBeTruthy();
  });

  it("scopes threads per workspace via storage key", () => {
    const ws1 = renderHook(() => useComments("ws1", "h"));
    addOne(ws1.result, "for ws1");
    const ws2 = renderHook(() => useComments("ws2", "h"));
    expect(ws2.result.current.threads).toHaveLength(0);
    addOne(ws2.result, "for ws2");
    expect(ws1.result.current.threads).toHaveLength(1);
    expect(ws2.result.current.threads).toHaveLength(1);
    expect(ws1.result.current.threads[0].messages[0].body).toBe("for ws1");
    expect(ws2.result.current.threads[0].messages[0].body).toBe("for ws2");
  });

  it("updates a message body and updatedAt", async () => {
    const { result } = renderHook(() => useComments("ws1", "h"));
    addOne(result, "first");
    const before = result.current.threads[0].messages[0].updatedAt;
    // Sleep a millisecond so updatedAt strictly increases.
    await new Promise((r) => setTimeout(r, 5));
    act(() => {
      const t = result.current.threads[0];
      result.current.updateMessage(t.id, t.messages[0].id, "edited");
    });
    expect(result.current.threads[0].messages[0].body).toBe("edited");
    expect(result.current.threads[0].messages[0].updatedAt).not.toBe(before);
  });

  it("removes a thread", () => {
    const { result } = renderHook(() => useComments("ws1", "h"));
    addOne(result, "first");
    const id = result.current.threads[0].id;
    act(() => result.current.removeThread(id));
    expect(result.current.threads).toHaveLength(0);
  });

  it("clearAll empties threads for the active commit and persists empty array", () => {
    const { result } = renderHook(() => useComments("ws1", "h"));
    addOne(result, "a");
    addOne(result, "b", { line: 2 });
    expect(result.current.threads).toHaveLength(2);
    act(() => result.current.clearAll());
    expect(result.current.threads).toHaveLength(0);
    expect(localStorage.getItem("diffmil.comments.ws1.h")).toBe("[]");
  });

  it("rejects invalid threads from localStorage", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.h",
      JSON.stringify([makeThread({ id: "ok" }), { broken: true }]),
    );
    const { result } = renderHook(() => useComments("ws1", "h"));
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe("ok");
  });

  it("stores endLine for multi-line threads but omits it for single-line", () => {
    const { result } = renderHook(() => useComments("ws1", "h"));
    addOne(result, "single");
    addOne(result, "ranged", { line: 5, endLine: 8 });
    // endLine === line should be normalized to undefined to save a few bytes
    // and keep the legacy on-disk shape for single-line threads.
    addOne(result, "same", { line: 3, endLine: 3 });
    expect(result.current.threads[0].endLine).toBeUndefined();
    expect(result.current.threads[1].endLine).toBe(8);
    expect(result.current.threads[2].endLine).toBeUndefined();
  });

  it("loads legacy threads without endLine field as valid", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.h",
      JSON.stringify([makeThread({ id: "legacy" })]),
    );
    const { result } = renderHook(() => useComments("ws1", "h"));
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].endLine).toBeUndefined();
  });

  it("rejects threads with non-numeric endLine", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.h",
      JSON.stringify([
        makeThread({ id: "ok" }),
        { ...makeThread({ id: "bad" }), endLine: "5" },
      ]),
    );
    const { result } = renderHook(() => useComments("ws1", "h"));
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe("ok");
  });

  it("no-ops when commitHash is null", () => {
    const { result } = renderHook(() => useComments("ws1", null));
    act(() => {
      result.current.addThread({
        filePath: "x",
        side: "new",
        line: 1,
        body: "ignored",
        codeSnapshot: "",
      });
    });
    expect(result.current.threads).toHaveLength(0);
  });
});

describe("listCommitsWithComments", () => {
  it("scans workspace-scoped keys", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-a",
      JSON.stringify([makeThread({ commitHash: "commit-a" })]),
    );
    localStorage.setItem("diffmil.comments.ws1.commit-b", JSON.stringify([]));
    localStorage.setItem(
      "diffmil.comments.ws2.commit-c",
      JSON.stringify([makeThread({ commitHash: "commit-c" })]),
    );
    expect([...listCommitsWithComments("ws1")]).toEqual(["commit-a"]);
    expect([...listCommitsWithComments("ws2")]).toEqual(["commit-c"]);
  });

  it("falls back to legacy flat key when wsId is null", () => {
    localStorage.setItem(
      "diffmil.comments.legacy-hash",
      JSON.stringify([makeThread({ commitHash: "legacy-hash" })]),
    );
    // ws-prefixed entry should not leak into legacy results.
    localStorage.setItem(
      "diffmil.comments.ws1.commit-a",
      JSON.stringify([makeThread({ commitHash: "commit-a" })]),
    );
    expect([...listCommitsWithComments(null)]).toEqual(["legacy-hash"]);
  });
});

describe("loadAllWorkspaceThreads", () => {
  it("returns valid threads grouped by commit hash within the workspace", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-a",
      JSON.stringify([makeThread({ id: "a1", commitHash: "commit-a" })]),
    );
    localStorage.setItem(
      "diffmil.comments.ws1.commit-b",
      JSON.stringify([
        makeThread({ id: "b1", commitHash: "commit-b" }),
        makeThread({ id: "b2", commitHash: "commit-b", line: 2 }),
      ]),
    );
    // Other workspace must not leak.
    localStorage.setItem(
      "diffmil.comments.ws2.commit-c",
      JSON.stringify([makeThread({ id: "c1", commitHash: "commit-c" })]),
    );
    const out = loadAllWorkspaceThreads("ws1");
    expect([...out.keys()].sort()).toEqual(["commit-a", "commit-b"]);
    expect(out.get("commit-a")).toHaveLength(1);
    expect(out.get("commit-b")).toHaveLength(2);
  });

  it("skips keys whose payload has no valid threads", () => {
    localStorage.setItem("diffmil.comments.ws1.commit-empty", JSON.stringify([]));
    localStorage.setItem(
      "diffmil.comments.ws1.commit-bad",
      JSON.stringify([{ broken: true }]),
    );
    const out = loadAllWorkspaceThreads("ws1");
    expect(out.size).toBe(0);
  });
});

describe("pruneOrphanWorkspaceComments", () => {
  it("removes entries whose commit hash is absent from keepHashes", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-keep",
      JSON.stringify([makeThread({ id: "k", commitHash: "commit-keep" })]),
    );
    localStorage.setItem(
      "diffmil.comments.ws1.commit-gone",
      JSON.stringify([
        makeThread({ id: "g1", commitHash: "commit-gone" }),
        makeThread({ id: "g2", commitHash: "commit-gone", line: 2 }),
      ]),
    );
    const removed = pruneOrphanWorkspaceComments(
      "ws1",
      new Set(["commit-keep"]),
    );
    expect(removed).toBe(2);
    expect(localStorage.getItem("diffmil.comments.ws1.commit-keep")).not.toBeNull();
    expect(localStorage.getItem("diffmil.comments.ws1.commit-gone")).toBeNull();
  });

  it("never touches keys from other workspaces", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-gone",
      JSON.stringify([makeThread({ id: "g1", commitHash: "commit-gone" })]),
    );
    localStorage.setItem(
      "diffmil.comments.ws2.commit-gone",
      JSON.stringify([makeThread({ id: "g2", commitHash: "commit-gone" })]),
    );
    pruneOrphanWorkspaceComments("ws1", new Set());
    expect(localStorage.getItem("diffmil.comments.ws1.commit-gone")).toBeNull();
    expect(localStorage.getItem("diffmil.comments.ws2.commit-gone")).not.toBeNull();
  });

  it("returns 0 when nothing is orphaned", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-a",
      JSON.stringify([makeThread({ id: "a", commitHash: "commit-a" })]),
    );
    const removed = pruneOrphanWorkspaceComments(
      "ws1",
      new Set(["commit-a", "commit-x"]),
    );
    expect(removed).toBe(0);
    expect(localStorage.getItem("diffmil.comments.ws1.commit-a")).not.toBeNull();
  });
});

describe("clearAllWorkspaceComments", () => {
  it("removes every workspace-scoped key and returns thread count", () => {
    localStorage.setItem(
      "diffmil.comments.ws1.commit-a",
      JSON.stringify([
        makeThread({ id: "a1", commitHash: "commit-a" }),
        makeThread({ id: "a2", commitHash: "commit-a", line: 2 }),
      ]),
    );
    localStorage.setItem(
      "diffmil.comments.ws1.commit-b",
      JSON.stringify([makeThread({ id: "b1", commitHash: "commit-b" })]),
    );
    // Other workspace must survive.
    localStorage.setItem(
      "diffmil.comments.ws2.commit-c",
      JSON.stringify([makeThread({ id: "c1", commitHash: "commit-c" })]),
    );
    const removed = clearAllWorkspaceComments("ws1");
    expect(removed).toBe(3);
    expect(localStorage.getItem("diffmil.comments.ws1.commit-a")).toBeNull();
    expect(localStorage.getItem("diffmil.comments.ws1.commit-b")).toBeNull();
    expect(localStorage.getItem("diffmil.comments.ws2.commit-c")).not.toBeNull();
  });

  it("returns 0 when there is nothing to clear", () => {
    expect(clearAllWorkspaceComments("ws-empty")).toBe(0);
  });
});
