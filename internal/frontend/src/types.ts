export interface DiffResponse {
  files: DiffFile[];
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
  codeSnapshot: string;
  createdAt: string;
  updatedAt: string;
  messages: CommentMessage[];
}
