/**
 * A named environment variable.
 * Node reads `process.env`. The browser overlay is `globalThis.__BURSAR_ENV__`,
 * and a key set there wins so the page can name the public blocklist contract
 * without a build-time replacement of `process.env`.
 */
export function env(name: string): string | undefined {
  const overlay = (globalThis as { __BURSAR_ENV__?: Record<string, string | undefined> }).__BURSAR_ENV__;
  if (overlay && Object.prototype.hasOwnProperty.call(overlay, name)) return overlay[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}
