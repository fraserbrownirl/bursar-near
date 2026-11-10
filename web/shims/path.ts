export function join(...parts: string[]): string {
  const cleaned = parts.filter((part) => part !== "");
  if (cleaned.length === 0) return ".";
  return cleaned.join("/").replace(/\/{2,}/g, "/");
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return path.slice(0, index);
}
