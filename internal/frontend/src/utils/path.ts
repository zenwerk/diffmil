export function basename(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i >= 0 ? filePath.slice(i + 1) : filePath;
}
