export const LINE_PREFIX: Record<string, string> = {
  add: "+",
  delete: "-",
  normal: " ",
};

export const LINE_BG: Record<string, string> = {
  add: "bg-diff-addition-bg",
  delete: "bg-diff-deletion-bg",
};

export const LINE_BG_HOVER: Record<string, string> = {
  add: "bg-diff-addition-bg hover:bg-diff-add-hover",
  delete: "bg-diff-deletion-bg hover:bg-diff-del-hover",
};

export type RangeState = "anchor" | "in-range" | "committed";

export const RANGE_BG: Record<RangeState, string> = {
  anchor: "bg-blue-500/20",
  "in-range": "bg-blue-500/10",
  committed: "bg-blue-500/10",
};
