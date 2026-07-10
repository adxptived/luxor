/**
 * Read-only hex dump viewer for binary files. Loads the file head in chunks
 * (64 KiB at a time) so arbitrarily large binaries never block the UI.
 */

import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/types";

const CHUNK = 64 * 1024;
const BYTES_PER_ROW = 16;

function toHex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

export function HexView({ path }: { path: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [limit, setLimit] = useState(CHUNK);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (max: number) => {
      setLoading(true);
      ipc
        .fsReadBase64(path, max)
        .then((b64) => {
          const data = ipc.b64ToBytes(b64);
          setBytes(data);
          // Shorter than requested means we reached the end of the file.
          setDone(data.length < max);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setLoading(false));
    },
    [path],
  );

  useEffect(() => {
    setBytes(null);
    setLimit(CHUNK);
    setDone(false);
    load(CHUNK);
  }, [load]);

  const rows = useMemo(() => {
    if (!bytes) return [];
    const out: Array<{ offset: number; hex: string; ascii: string }> = [];
    for (let off = 0; off < bytes.length; off += BYTES_PER_ROW) {
      const slice = bytes.subarray(off, off + BYTES_PER_ROW);
      let hex = "";
      let ascii = "";
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        if (i < slice.length) {
          hex += toHex(slice[i], 2) + (i === 7 ? "  " : " ");
          ascii += slice[i] >= 0x20 && slice[i] < 0x7f ? String.fromCharCode(slice[i]) : "·";
        } else {
          hex += i === 7 ? "    " : "   ";
        }
      }
      out.push({ offset: off, hex, ascii });
    }
    return out;
  }, [bytes]);

  if (error) {
    return <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">{error}</div>;
  }

  if (!bytes) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> {t("common.loading", "Loading…")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-edge px-3 py-1 text-xs text-muted">
        {t("Hex view (read-only)")} · {bytes.length.toLocaleString()} B{done ? "" : ` ${t("(partial)")}`}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-xs leading-5">
        {rows.map((r) => (
          <div key={r.offset} className="flex gap-4 whitespace-pre hover:bg-raised/60">
            <span className="text-muted">{toHex(r.offset, 8)}</span>
            <span className="text-strong">{r.hex}</span>
            <span className="text-muted">{r.ascii}</span>
          </div>
        ))}
        {!done && (
          <button
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-edge px-3 py-1 text-xs text-muted hover:bg-raised hover:text-strong disabled:opacity-40"
            disabled={loading}
            onClick={() => {
              const next = limit + CHUNK * 4;
              setLimit(next);
              load(next);
            }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
            {t("Load more")}
          </button>
        )}
      </div>
    </div>
  );
}
