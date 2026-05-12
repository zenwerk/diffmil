import { describe, it, expect } from "vitest";
import {
  formatThreadPrompt,
  formatAllThreadsPrompt,
  toCommitContext,
} from "./commentPrompt";
import type { Commit, CommentThread } from "../types";

const mkThread = (overrides: Partial<CommentThread> = {}): CommentThread => ({
  id: "t1",
  commitHash: "abc123",
  filePath: "src/foo.ts",
  side: "new",
  line: 42,
  codeSnapshot: "const x = 1",
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
  messages: [
    {
      id: "m1",
      body: "ここは null チェック必要では？",
      createdAt: "2026-05-12T00:00:00Z",
      updatedAt: "2026-05-12T00:00:00Z",
    },
  ],
  ...overrides,
});

describe("formatThreadPrompt", () => {
  it("includes file, line, side, code, body", () => {
    const out = formatThreadPrompt(mkThread());
    expect(out).toContain("src/foo.ts:L42 (new)");
    expect(out).toContain("const x = 1");
    expect(out).toContain("ここは null チェック必要では？");
  });

  it("includes commit header when context is provided", () => {
    const ctx = {
      hash: "abc123def",
      short: "abc123d",
      subject: "Fix bug",
      author: "alice",
    };
    const out = formatThreadPrompt(mkThread(), ctx);
    expect(out).toContain("Commit: abc123d (abc123def)");
    expect(out).toContain("Subject: Fix bug");
    expect(out).toContain("Author: alice");
  });

  it("falls back to commitHash when no context given", () => {
    const out = formatThreadPrompt(mkThread());
    expect(out).toContain("Commit: abc123");
  });

  it("separates code block from message with blank line", () => {
    const out = formatThreadPrompt(mkThread());
    // Pattern: closing ``` followed by blank line then body
    expect(out).toMatch(/```\n\nここは null/);
  });
});

describe("formatAllThreadsPrompt", () => {
  it("joins threads with the ===== separator", () => {
    const a = mkThread({ id: "1", line: 1 });
    const b = mkThread({ id: "2", line: 2 });
    const out = formatAllThreadsPrompt([a, b]);
    expect(out).toContain("\n=====\n");
    expect(out).toContain(":L1 (new)");
    expect(out).toContain(":L2 (new)");
  });

  it("returns empty string for empty input", () => {
    expect(formatAllThreadsPrompt([])).toBe("");
  });
});

describe("toCommitContext", () => {
  it("returns just hash when commit is null", () => {
    expect(toCommitContext(null, "abc")).toEqual({ hash: "abc" });
  });

  it("flattens a Commit object", () => {
    const c: Commit = {
      hash: "abc",
      short: "abc",
      subject: "msg",
      author: "alice",
      date: "2026-01-01",
    };
    expect(toCommitContext(c, "abc")).toEqual({
      hash: "abc",
      short: "abc",
      subject: "msg",
      author: "alice",
      date: "2026-01-01",
    });
  });
});
