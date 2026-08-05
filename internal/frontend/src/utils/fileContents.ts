// Fetch wrapper for GET /_/api/file, used by the @pierre/diffs `loadDiffFiles`
// loader (see pierreLoader.ts) to hydrate partial diffs with full file
// contents for hunk expansion. Any failure (network error, non-200, or a
// `null` contents field) collapses to `null` rather than throwing, because a
// failed expansion should leave the collapsed context in place, not blow up
// the render.
export async function fetchFileContents(params: {
  workspaceId?: string;
  commit?: string;
  path: string;
  side: "old" | "new";
}): Promise<string | null> {
  const qs = new URLSearchParams();
  if (params.workspaceId) qs.set("ws", params.workspaceId);
  if (params.commit) qs.set("commit", params.commit);
  qs.set("path", params.path);
  qs.set("side", params.side);

  try {
    const res = await fetch(`/_/api/file?${qs.toString()}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { contents: string | null };
    return body.contents;
  } catch {
    return null;
  }
}
