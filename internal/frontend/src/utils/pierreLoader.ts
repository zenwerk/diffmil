import type {
  FileContents,
  FileDiffContentsLoader,
  FileDiffLoadedFiles,
  FileDiffMetadata,
} from "@pierre/diffs";
import { fetchFileContents } from "./fileContents";

// buildDiffFilesLoader wires up @pierre/diffs' `loadDiffFiles` option so the
// separator "expand" buttons can hydrate a partial (patch-parsed) diff with
// full file contents on demand.
//
// Facts verified against the vendored @pierre/diffs v1.3.3 source
// (components/FileDiff.ts, utils/hydratePartialDiff.ts):
//
//  - The loader is only ever invoked for `isPartial` diffs of type 'change',
//    'rename-changed', or 'rename-pure' (see `canHydrateDiff` in
//    components/FileDiff.ts). 'new'/'deleted' diffs already carry one full
//    side from the initial parse and are never passed to the loader.
//  - `hydratePartialDiff` requires `oldFile` to be exactly `null` for
//    'rename-pure' (it throws otherwise) and requires both `oldFile` and
//    `newFile` to be non-null for 'change'/'rename-changed'.
//  - If the loader throws (or its returned promise rejects), FileDiff's
//    `loadFilesForDiff` catches the error, `console.error`s it, and returns
//    without hydrating — `fileDiff.isPartial` stays `true` and the separator
//    is left exactly as it was (still showing its expand affordance, ready to
//    retry on the next click). It does NOT fall back to partial/fake data.
//    That means throwing on a failed fetch is the correct way to signal
//    failure; returning fabricated FileContents would corrupt the diff.
export function buildDiffFilesLoader(params: {
  workspaceId?: string;
  commit?: string;
  fetcher?: typeof fetchFileContents;
}): FileDiffContentsLoader | undefined {
  const { workspaceId, commit } = params;
  // No workspace means there's no server-side blob to read from, so there's
  // nothing a loader could fetch — matching current parity, omit it entirely
  // (no loader = no expand button, same as before Phase 3).
  if (!workspaceId) return undefined;

  const fetcher = params.fetcher ?? fetchFileContents;

  return async function loadDiffFiles(
    fileDiff: FileDiffMetadata,
  ): Promise<FileDiffLoadedFiles> {
    switch (fileDiff.type) {
      case "rename-pure": {
        const newFile = await fetchSide(fetcher, {
          workspaceId,
          commit,
          path: fileDiff.name,
          side: "new",
          fileDiff,
        });
        return { oldFile: null, newFile };
      }
      case "change":
      case "rename-changed": {
        const oldPath = fileDiff.prevName ?? fileDiff.name;
        const [oldFile, newFile] = await Promise.all([
          fetchSide(fetcher, {
            workspaceId,
            commit,
            path: oldPath,
            side: "old",
            fileDiff,
          }),
          fetchSide(fetcher, {
            workspaceId,
            commit,
            path: fileDiff.name,
            side: "new",
            fileDiff,
          }),
        ]);
        return { oldFile, newFile };
      }
      default:
        // Defensive: the renderer never calls the loader for 'new'/'deleted'
        // diffs (they're not partial in the ways this loader handles), and
        // there's no FileDiffLoadedFiles shape that fits a one-sided diff.
        // Throwing surfaces a clear error instead of silently mis-hydrating.
        throw new Error(
          `buildDiffFilesLoader: unexpected fileDiff.type "${fileDiff.type}" for "${fileDiff.name}"`,
        );
    }
  };
}

async function fetchSide(
  fetcher: typeof fetchFileContents,
  params: {
    workspaceId: string;
    commit?: string;
    path: string;
    side: "old" | "new";
    fileDiff: FileDiffMetadata;
  },
): Promise<FileContents> {
  const { workspaceId, commit, path, side, fileDiff } = params;
  const contents = await fetcher({ workspaceId, commit, path, side });
  if (contents == null) {
    throw new Error(
      `buildDiffFilesLoader: failed to load ${side} contents for "${path}" (fileDiff "${fileDiff.name}")`,
    );
  }
  const cacheKey = fileDiff.cacheKey != null ? `${fileDiff.cacheKey}:${side}` : undefined;
  return { name: path, contents, cacheKey };
}
