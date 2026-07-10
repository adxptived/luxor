/**
 * Bundle analysis script.
 *
 * Run with: ANALYZE=1 bun run build
 * Produces a JSON report of chunk sizes and dependencies, saved to
 * dist/bundle-report.json for inspection.
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface ChunkInfo {
  name: string;
  size: number;
  sizeKB: number;
  gzipEstimate: number;
}

function walkDir(dir: string, base: string = ""): ChunkInfo[] {
  const chunks: ChunkInfo[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relPath = base ? `${base}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        chunks.push(...walkDir(fullPath, relPath));
      } else if (entry.endsWith(".js") || entry.endsWith(".css")) {
        // Rough gzip estimate: ~30% of original for minified JS/CSS.
        const gzipEstimate = Math.round(stat.size * 0.3);
        chunks.push({
          name: relPath,
          size: stat.size,
          sizeKB: Math.round(stat.size / 1024),
          gzipEstimate,
        });
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable.
  }
  return chunks;
}

function main() {
  const distDir = resolve(process.cwd(), "dist");
  const chunks = walkDir(distDir);
  chunks.sort((a, b) => b.size - a.size);

  const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
  const totalGzip = chunks.reduce((sum, c) => sum + c.gzipEstimate, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    totalChunks: chunks.length,
    totalSizeKB: Math.round(totalSize / 1024),
    totalGzipEstimateKB: Math.round(totalGzip / 1024),
    chunks: chunks.map((c) => ({
      ...c,
      percentage: ((c.size / totalSize) * 100).toFixed(1) + "%",
    })),
  };

  const reportPath = join(distDir, "bundle-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n📦 Bundle Analysis Report");
  console.log("========================");
  console.log(`Total chunks: ${report.totalChunks}`);
  console.log(`Total size: ${report.totalSizeKB} KB (est. gzip: ${report.totalGzipEstimateKB} KB)`);
  console.log("\nTop 10 largest chunks:");
  for (const c of chunks.slice(0, 10)) {
    // Compute here: `chunks` holds raw ChunkInfo — `percentage` only exists on
    // the mapped copies inside `report.chunks` (was a real TS error, audit 6.3).
    const percentage = totalSize > 0 ? ((c.size / totalSize) * 100).toFixed(1) + "%" : "0%";
    console.log(`  ${c.name.padEnd(40)} ${String(c.sizeKB).padStart(8)} KB  (${percentage})  gzip~${Math.round(c.gzipEstimate / 1024)} KB`);
  }
  console.log(`\nFull report: ${reportPath}`);
}

main();
