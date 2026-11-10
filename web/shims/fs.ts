const files = new Map<string, string>();

function keyOf(path: string | URL): string {
  return typeof path === "string" ? path : path.href;
}

export function mkdirSync(_path: string, _options?: { recursive?: boolean }): void {}

export function existsSync(path: string | URL): boolean {
  return files.has(keyOf(path));
}

export function readFileSync(path: string | URL, _encoding?: string): string {
  const key = keyOf(path);
  const text = files.get(key);
  if (text === undefined) throw new Error(`ENOENT: ${key}`);
  return text;
}

export function writeFileSync(path: string | URL, data: string): void {
  files.set(keyOf(path), String(data));
}

export function appendFileSync(path: string | URL, data: string): void {
  const key = keyOf(path);
  files.set(key, (files.get(key) ?? "") + String(data));
}
