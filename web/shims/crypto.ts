import { sha256 } from "@noble/hashes/sha2";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`unsupported hash ${algorithm}`);
  const parts: Uint8Array[] = [];
  return {
    update(data: string) {
      parts.push(new TextEncoder().encode(data));
      return this;
    },
    digest(encoding: string) {
      if (encoding !== "hex") throw new Error(encoding);
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      return hex(sha256(bytes));
    },
  };
}
