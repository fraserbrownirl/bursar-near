const overlay: Record<string, string | undefined> = {
  BURSAR_BLOCKLIST_CONTRACT: "bursar-rep-7f1d8a2b.testnet",
  BURSAR_BLOCKLIST_RPC: "https://rpc.testnet.near.org",
  BURSAR_TRUSTED_REPORTERS: "bursar-rep-7f1d8a2b.testnet",
  BURSAR_HOME: "/bursar",
};

(globalThis as { __BURSAR_ENV__?: Record<string, string | undefined> }).__BURSAR_ENV__ = overlay;

export function homeFor(name: string): void {
  overlay.BURSAR_HOME = `/bursar/${name}`;
}
