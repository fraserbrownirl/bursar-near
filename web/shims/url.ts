export function fileURLToPath(url: string | URL): string {
  const href = typeof url === "string" ? url : url.href;
  if (href.startsWith("file:")) return decodeURIComponent(new URL(href).pathname);
  return href;
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path}`);
}
