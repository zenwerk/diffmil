export const STATUS_META: Record<
  string,
  { label: string; colorClass: string }
> = {
  modified: { label: "M", colorClass: "text-gh-warning" },
  added: { label: "A", colorClass: "text-gh-accent" },
  deleted: { label: "D", colorClass: "text-gh-danger" },
  renamed: { label: "R", colorClass: "text-purple-400" },
};
