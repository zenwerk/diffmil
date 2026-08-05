import { describe, it, expect, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import { buildDiffFilesLoader } from "./pierreLoader";

function makeFileDiff(overrides: Partial<FileDiffMetadata>): FileDiffMetadata {
  return {
    name: "src/foo.ts",
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    ...overrides,
  };
}

describe("buildDiffFilesLoader", () => {
  it("fetches both sides for a 'change' diff and returns them", async () => {
    const fetcher = vi.fn(async (params: { side: "old" | "new"; path: string }) =>
      params.side === "old" ? "old contents" : "new contents",
    );
    const loader = buildDiffFilesLoader({
      workspaceId: "ws1",
      commit: "abc123",
      fetcher,
    });
    expect(loader).toBeDefined();

    const fileDiff = makeFileDiff({ type: "change", name: "src/foo.ts" });
    const result = await loader!(fileDiff);

    expect(fetcher).toHaveBeenCalledWith({
      workspaceId: "ws1",
      commit: "abc123",
      path: "src/foo.ts",
      side: "old",
    });
    expect(fetcher).toHaveBeenCalledWith({
      workspaceId: "ws1",
      commit: "abc123",
      path: "src/foo.ts",
      side: "new",
    });
    expect(result).toEqual({
      oldFile: { name: "src/foo.ts", contents: "old contents", cacheKey: undefined },
      newFile: { name: "src/foo.ts", contents: "new contents", cacheKey: undefined },
    });
  });

  it("fetches the old side using prevName for a 'rename-changed' diff", async () => {
    const fetcher = vi.fn(async (params: { side: "old" | "new" }) =>
      params.side === "old" ? "old contents" : "new contents",
    );
    const loader = buildDiffFilesLoader({ workspaceId: "ws1", fetcher });

    const fileDiff = makeFileDiff({
      type: "rename-changed",
      name: "src/new.ts",
      prevName: "src/old.ts",
    });
    const result = await loader!(fileDiff);

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/old.ts", side: "old" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/new.ts", side: "new" }),
    );
    expect(result.oldFile).toEqual({ name: "src/old.ts", contents: "old contents", cacheKey: undefined });
    expect(result.newFile).toEqual({ name: "src/new.ts", contents: "new contents", cacheKey: undefined });
  });

  it("only fetches the new side for a 'rename-pure' diff and returns oldFile: null", async () => {
    const fetcher = vi.fn(async () => "new contents");
    const loader = buildDiffFilesLoader({ workspaceId: "ws1", fetcher });

    const fileDiff = makeFileDiff({
      type: "rename-pure",
      name: "src/new.ts",
      prevName: "src/old.ts",
      hunks: [],
    });
    const result = await loader!(fileDiff);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/new.ts", side: "new" }),
    );
    expect(result).toEqual({
      oldFile: null,
      newFile: { name: "src/new.ts", contents: "new contents", cacheKey: undefined },
    });
  });

  it("throws when a side's contents cannot be fetched (returns null)", async () => {
    const fetcher = vi.fn(async (params: { side: "old" | "new" }) =>
      params.side === "old" ? null : "new contents",
    );
    const loader = buildDiffFilesLoader({ workspaceId: "ws1", fetcher });

    const fileDiff = makeFileDiff({ type: "change", name: "src/foo.ts" });
    await expect(loader!(fileDiff)).rejects.toThrow();
  });

  it("throws when the single side of a pure rename cannot be fetched", async () => {
    const fetcher = vi.fn(async () => null);
    const loader = buildDiffFilesLoader({ workspaceId: "ws1", fetcher });

    const fileDiff = makeFileDiff({ type: "rename-pure", name: "src/new.ts" });
    await expect(loader!(fileDiff)).rejects.toThrow();
  });

  it("includes side-suffixed cacheKey when fileDiff.cacheKey is set", async () => {
    const fetcher = vi.fn(async (params: { side: "old" | "new" }) =>
      params.side === "old" ? "old contents" : "new contents",
    );
    const loader = buildDiffFilesLoader({ workspaceId: "ws1", fetcher });

    const fileDiff = makeFileDiff({ type: "change", name: "src/foo.ts", cacheKey: "patch-1" });
    const result = await loader!(fileDiff);

    expect(result.oldFile?.cacheKey).toBe("patch-1:old");
    expect(result.newFile?.cacheKey).toBe("patch-1:new");
  });
});
