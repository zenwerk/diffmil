export interface DiffResponse {
  files: DiffFile[];
  // Raw unified diff text for the whole response, and the sole input to the
  // @pierre/diffs renderer. Sent by the server as `patch` (omitempty), so it
  // is absent for responses produced before the field existed — e.g. a cached
  // POST payload. Consumers must fall back to RawDiffViewer (which reads
  // `files[].chunks`) when it is missing.
  patch?: string;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  isBinary?: boolean;
  chunks: DiffChunk[];
}

export interface DiffChunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "delete" | "normal";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export type DiffViewMode = "unified" | "split";

export interface Workspace {
  id: string;
  dir: string;
  label: string;
  addedAt: string;
}

export interface Commit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  tags?: string[];
}

export type DiffSide = "old" | "new";

export interface CommentMessage {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentThread {
  id: string;
  commitHash: string;
  filePath: string;
  side: DiffSide;
  line: number;
  // endLine is the last line of a multi-line range. Single-line threads
  // omit this field (or set it equal to `line`).
  endLine?: number;
  codeSnapshot: string;
  createdAt: string;
  updatedAt: string;
  messages: CommentMessage[];
}
