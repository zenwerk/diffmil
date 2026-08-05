import { describe, it, expect } from "vitest";
import { buildFileDiffMap, findFileDiff } from "./pierrePatch";

// A realistic `git diff` covering every status our server reports:
// modified, added, deleted, rename-with-changes and pure rename.
const PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const z = 3;
-export const w = 4;
diff --git a/src/old-name.ts b/src/renamed.ts
similarity index 87%
rename from src/old-name.ts
rename to src/renamed.ts
index 5555555..6666666 100644
--- a/src/old-name.ts
+++ b/src/renamed.ts
@@ -1,3 +1,3 @@
 const p = 1;
-const q = 2;
+const q = 22;
 const r = 3;
diff --git a/pure-old.txt b/pure-new.txt
similarity index 100%
rename from pure-old.txt
rename to pure-new.txt
`;

describe("buildFileDiffMap", () => {
  it("keys every file by its post-change path with no a// b/ prefix", () => {
    const map = buildFileDiffMap(PATCH);
    expect([...map.keys()].sort()).toEqual([
      "pure-new.txt",
      "src/foo.ts",
      "src/gone.ts",
      "src/new.ts",
      "src/renamed.ts",
    ]);
  });

  it("classifies a modified file and keeps its hunks", () => {
    const f = buildFileDiffMap(PATCH).get("src/foo.ts");
    expect(f?.type).toBe("change");
    expect(f?.prevName).toBeUndefined();
    expect(f?.hunks.length).toBe(1);
  });

  it("classifies an added file", () => {
    const f = buildFileDiffMap(PATCH).get("src/new.ts");
    expect(f?.type).toBe("new");
    expect(f?.hunks.length).toBe(1);
  });

  it("classifies a deleted file", () => {
    const f = buildFileDiffMap(PATCH).get("src/gone.ts");
    expect(f?.type).toBe("deleted");
    expect(f?.hunks.length).toBe(1);
  });

  it("exposes the old path on a rename that also changed content", () => {
    const f = buildFileDiffMap(PATCH).get("src/renamed.ts");
    expect(f?.type).toBe("rename-changed");
    expect(f?.prevName).toBe("src/old-name.ts");
    expect(f?.hunks.length).toBe(1);
  });

  it("represents a pure rename with no hunks", () => {
    const f = buildFileDiffMap(PATCH).get("pure-new.txt");
    expect(f?.type).toBe("rename-pure");
    expect(f?.prevName).toBe("pure-old.txt");
    expect(f?.hunks.length).toBe(0);
  });

  // Diffs parsed straight from a patch carry no full file contents, so they
  // are partial. This is what makes context expansion unavailable until a
  // loadDiffFiles loader is supplied — the renderer hides its expand buttons.
  it("marks patch-parsed diffs as partial", () => {
    const map = buildFileDiffMap(PATCH);
    for (const f of map.values()) {
      expect(f.isPartial).toBe(true);
    }
  });

  it("returns an empty map for empty input", () => {
    expect(buildFileDiffMap("").size).toBe(0);
  });

  it("returns stable object identities that callers can memoize", () => {
    const map = buildFileDiffMap(PATCH);
    expect(map.get("src/foo.ts")).toBe(map.get("src/foo.ts"));
  });
});

describe("findFileDiff", () => {
  const map = buildFileDiffMap(PATCH);

  it("finds a file by its current path", () => {
    expect(findFileDiff(map, "src/foo.ts")?.name).toBe("src/foo.ts");
  });

  it("finds a renamed file by its new path", () => {
    expect(findFileDiff(map, "src/renamed.ts", "src/old-name.ts")?.name).toBe(
      "src/renamed.ts",
    );
  });

  it("falls back to the old path when the new path does not match", () => {
    expect(findFileDiff(map, "src/does-not-exist.ts", "src/foo.ts")?.name).toBe(
      "src/foo.ts",
    );
  });

  it("returns undefined when nothing matches", () => {
    expect(findFileDiff(map, "src/unknown.ts")).toBeUndefined();
  });
});
