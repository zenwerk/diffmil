import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

// buildFileDiffMap parses a raw unified diff into @pierre/diffs metadata and
// keys it by file path so it can be matched against our own DiffFile list.
//
// Two facts about parsePatchFiles drive this module (both verified against
// v1.3.3 by parsing real `git diff` output):
//
//  1. It returns ParsedPatch[] — an array, one entry per patch in the input.
//     A plain `git diff` yields a single element, but a `git format-patch`
//     stream yields several, so we flatten across all of them.
//  2. `FileDiffMetadata.name` is the *new* path with the `a/`/`b/` prefix
//     already stripped (the parser's regexes consume it), so it lines up with
//     DiffFile.path verbatim — no normalization needed. For renames, the old
//     path lands in `prevName`; for pure renames (similarity index 100%) the
//     file has no hunks at all.
//
// The returned metadata objects are mutated in place by the renderer when it
// hydrates expanded context, so callers must parse once and keep the same
// object identities across renders (i.e. hold this behind a useMemo).
// patchCacheKeyPrefix derives a cache key prefix that is unique per patch
// *content*. Passing it to parsePatchFiles matters beyond caching: when a
// FileDiffMetadata reaches FileDiff.render with cacheKey undefined, the
// library auto-assigns the file *name* as the cacheKey. Two different diffs
// of the same path (e.g. the working-tree diff and a commit's diff) then
// collide in the render cache, and switching commits keeps showing the stale
// DOM for any file present in both. A content-derived prefix keeps revisits
// of the same patch cache-friendly while distinct patches stay distinct.
export function patchCacheKeyPrefix(patch: string): string {
  // FNV-1a, 32-bit. Not cryptographic — just cheap and stable content identity.
  let hash = 0x811c9dc5;
  for (let i = 0; i < patch.length; i++) {
    hash ^= patch.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `patch:${(hash >>> 0).toString(36)}`;
}

export function buildFileDiffMap(patch: string, cacheKeyPrefix?: string): Map<string, FileDiffMetadata> {
  const map = new Map<string, FileDiffMetadata>();
  if (!patch) return map;

  let patches: ReturnType<typeof parsePatchFiles>;
  try {
    patches = parsePatchFiles(patch, cacheKeyPrefix);
  } catch (err) {
    console.warn("pierrePatch: failed to parse patch", err);
    return map;
  }

  for (const parsed of patches) {
    for (const file of parsed.files) {
      if (!file.name) continue;
      // Later entries win: if the same path somehow appears twice the last
      // occurrence is the most recent state of that file.
      map.set(file.name, file);
    }
  }
  return map;
}

// findFileDiff resolves the metadata for one of our DiffFile entries.
// It matches on the new path first, then falls back to the pre-rename path —
// our own `path` for a rename is the new name, but a defensive fallback keeps
// an unusual server-side rename representation from silently missing.
export function findFileDiff(
  map: Map<string, FileDiffMetadata>,
  path: string,
  oldPath?: string,
): FileDiffMetadata | undefined {
  const direct = map.get(path);
  if (direct) return direct;
  if (oldPath) {
    const byOld = map.get(oldPath);
    if (byOld) return byOld;
  }
  return undefined;
}
