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
