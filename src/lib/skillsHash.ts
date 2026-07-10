/** SHA-256 hash (lowercase hex) via WebCrypto. Use this for anything
 *  security-sensitive (plugin content verification); FNV below is only a fast
 *  non-cryptographic checksum for change detection. */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** FNV-1a 64-bit hash (hex) — mirrors `luxor-core::skills::fnv1a64` so the
 *  frontend can compare local skill content with the skills.sh version.
 *  NOT cryptographic — never use for trust/verification decisions. */
export function fnv1a64Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const b of data) {
    hash ^= BigInt(b);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
