/**
 * In-memory demo project for the browser/dev mock backend.
 *
 * `bun run dev`, the Playwright suite and the visual-regression screenshots all
 * run without Tauri. Before this module the mock file system answered every
 * `fs_list_dir` with the same two entries, so the explorer, editor, quick open
 * and project search could not be exercised in the browser at all. Paths under
 * `DEMO_ROOT` are now served from a small, realistic project tree that the
 * explorer can create, rename, copy and delete in; any other path keeps the old
 * fixtures so existing specs behave exactly as before.
 *
 * Only imported by `ipcMock.ts`, which is itself loaded lazily and never in
 * the desktop build.
 */

import type { FsEntry, SearchHit, SearchReport } from "./types";

export const DEMO_ROOT = "/home/dev/aurora-shop";

type Node = { dir: true; mtime: number } | { dir: false; content: string; mtime: number };

const files: Record<string, string> = {
  "README.md": `# Aurora Shop

A small storefront used to try Luxor without a real project.

## Getting started

\`\`\`bash
bun install
bun run dev
\`\`\`

## Layout

- \`src/\` — React client
- \`server/\` — API routes
- \`tests/\` — unit tests

See [the architecture notes](docs/architecture.md).
`,
  "package.json": `{
  "name": "aurora-shop",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "bun test",
    "lint": "eslint ."
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  }
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src", "server"]
}
`,
  ".gitignore": "node_modules\ndist\n.env\n",
  ".env.example": "API_URL=http://localhost:8080\nSTRIPE_KEY=\n",
  "src/main.tsx": `import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
  "src/App.tsx": `import { useEffect, useState } from "react";

import { Cart } from "./components/Cart";
import { Header } from "./components/Header";
import { ProductCard } from "./components/ProductCard";
import { fetchProducts, type Product } from "./lib/api";

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Product[]>([]);

  useEffect(() => {
    void fetchProducts().then(setProducts);
  }, []);

  return (
    <div className="app">
      <Header count={cart.length} />
      <main className="grid">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onAdd={() => setCart((c) => [...c, p])} />
        ))}
      </main>
      <Cart items={cart} />
    </div>
  );
}
`,
  "src/components/Header.tsx": `export function Header({ count }: { count: number }) {
  return (
    <header className="header">
      <h1>Aurora</h1>
      <span className="badge">{count}</span>
    </header>
  );
}
`,
  "src/components/ProductCard.tsx": `import { formatPrice } from "../lib/format";
import type { Product } from "../lib/api";

export function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  return (
    <article className="card">
      <h2>{product.name}</h2>
      <p>{formatPrice(product.price)}</p>
      <button onClick={onAdd}>Add to cart</button>
    </article>
  );
}
`,
  "src/components/Cart.tsx": `import { formatPrice } from "../lib/format";
import type { Product } from "../lib/api";

export function Cart({ items }: { items: Product[] }) {
  const total = items.reduce((sum, p) => sum + p.price, 0);
  return (
    <aside className="cart">
      <h2>Cart</h2>
      <ul>
        {items.map((p, i) => (
          <li key={i}>{p.name}</li>
        ))}
      </ul>
      <strong>{formatPrice(total)}</strong>
    </aside>
  );
}
`,
  "src/lib/api.ts": `export interface Product {
  id: string;
  name: string;
  price: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(\`\${API_URL}/products\`);
  if (!res.ok) throw new Error(\`products: \${res.status}\`);
  return (await res.json()) as Product[];
}
`,
  "src/lib/format.ts": `const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatPrice(cents: number): string {
  return money.format(cents / 100);
}
`,
  "src/styles/app.css": `.app {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 24px;
}

.card {
  border-radius: 8px;
  padding: 16px;
}
`,
  "server/index.ts": `import { serve } from "bun";

import { products } from "./routes/products";

serve({
  port: 8080,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/products") return products();
    return new Response("not found", { status: 404 });
  },
});
`,
  "server/routes/products.ts": `const CATALOG = [
  { id: "lamp", name: "Desk lamp", price: 4900 },
  { id: "mug", name: "Stoneware mug", price: 1800 },
  { id: "chair", name: "Oak chair", price: 18900 },
];

export function products(): Response {
  return Response.json(CATALOG);
}
`,
  "tests/cart.test.ts": `import { expect, test } from "bun:test";

import { formatPrice } from "../src/lib/format";

test("formats cents as dollars", () => {
  expect(formatPrice(4900)).toBe("$49.00");
});
`,
  "docs/architecture.md": `# Architecture

The client talks to a tiny Bun server over HTTP. Prices are stored in cents.
`,
  "scripts/deploy.sh": `#!/usr/bin/env bash
set -euo pipefail
bun run build
rsync -av dist/ deploy@shop:/srv/aurora
`,
  "public/favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8b059"/></svg>
`,
};

const tree = new Map<string, Node>();
let clock = Date.UTC(2026, 9, 30, 12, 0, 0);
const tick = () => (clock += 1000);

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/";
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function ensureDir(path: string): void {
  if (tree.has(path) || !path.startsWith(DEMO_ROOT)) return;
  if (path !== DEMO_ROOT) ensureDir(parentOf(path));
  tree.set(path, { dir: true, mtime: tick() });
}

function seed(): void {
  ensureDir(DEMO_ROOT);
  for (const [rel, content] of Object.entries(files)) {
    const path = `${DEMO_ROOT}/${rel}`;
    ensureDir(parentOf(path));
    tree.set(path, { dir: false, content, mtime: tick() });
  }
}
seed();

/** True when `path` belongs to the demo project (and the mock should serve it). */
export function inDemo(path: unknown): path is string {
  return typeof path === "string" && (path === DEMO_ROOT || path.startsWith(`${DEMO_ROOT}/`));
}

function entry(path: string, node: Node): FsEntry {
  return {
    name: nameOf(path),
    path,
    is_dir: node.dir,
    size: node.dir ? 0 : new TextEncoder().encode(node.content).byteLength,
    modified: new Date(node.mtime).toISOString(),
  };
}

function childrenOf(dir: string): string[] {
  const prefix = `${dir}/`;
  return [...tree.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
}

export function demoList(dir: string): FsEntry[] {
  const node = tree.get(dir);
  if (!node?.dir) throw new Error(`not a directory: ${dir}`);
  return childrenOf(dir)
    .map((p) => entry(p, tree.get(p) as Node))
    .sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function demoRead(path: string): { content: string; truncated: boolean; mtime_ms: number } {
  const node = tree.get(path);
  if (!node) throw new Error(`not found: ${path}`);
  if (node.dir) throw new Error(`is a directory: ${path}`);
  return { content: node.content, truncated: false, mtime_ms: node.mtime };
}

export function demoWrite(path: string, content: string): number {
  ensureDir(parentOf(path));
  const mtime = tick();
  tree.set(path, { dir: false, content, mtime });
  return mtime;
}

export function demoCreateFile(path: string): void {
  if (tree.has(path)) throw new Error(`already exists: ${nameOf(path)}`);
  demoWrite(path, "");
}

export function demoCreateDir(path: string): void {
  if (tree.has(path)) throw new Error(`already exists: ${nameOf(path)}`);
  ensureDir(path);
}

function subtree(path: string): string[] {
  return [...tree.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
}

export function demoRename(from: string, to: string): void {
  if (!tree.has(from)) throw new Error(`not found: ${from}`);
  if (tree.has(to)) throw new Error(`already exists: ${nameOf(to)}`);
  ensureDir(parentOf(to));
  for (const p of subtree(from)) {
    const node = tree.get(p) as Node;
    tree.delete(p);
    tree.set(to + p.slice(from.length), node);
  }
}

export function demoCopy(from: string, to: string): void {
  if (!tree.has(from)) throw new Error(`not found: ${from}`);
  if (tree.has(to)) throw new Error(`already exists: ${nameOf(to)}`);
  ensureDir(parentOf(to));
  for (const p of subtree(from)) {
    const node = tree.get(p) as Node;
    tree.set(to + p.slice(from.length), { ...node, mtime: tick() });
  }
}

export function demoDelete(path: string): void {
  for (const p of subtree(path)) tree.delete(p);
}

/** Name/path search used by the explorer filter (`fs_search`). */
export function demoSearch(root: string, query: string, limit: number): FsEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: FsEntry[] = [];
  for (const [path, node] of tree) {
    if (path === root || !path.startsWith(`${root}/`)) continue;
    if (path.slice(root.length + 1).toLowerCase().includes(q)) out.push(entry(path, node));
    if (out.length >= limit) break;
  }
  return out;
}

/** Content search used by the Search panel (`search_in_project`). */
export function demoGrep(root: string, query: string, useRegex: boolean, caseSensitive: boolean): SearchReport {
  const hits: SearchHit[] = [];
  let scanned = 0;
  let re: RegExp;
  try {
    re = useRegex
      ? new RegExp(query, caseSensitive ? "g" : "gi")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch {
    return { hits, files_scanned: 0, truncated: false };
  }
  for (const [path, node] of tree) {
    if (node.dir || !path.startsWith(`${root}/`)) continue;
    scanned += 1;
    node.content.split("\n").forEach((text, i) => {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m && m[0].length > 0) hits.push({ path, line: i + 1, text, start: m.index, end: m.index + m[0].length });
    });
  }
  return { hits, files_scanned: scanned, truncated: false };
}

/** A believable working-tree status for the demo project. */
export const DEMO_GIT_STATUS = {
  branch: "feature/cart-totals",
  head_detached: false,
  ahead: 2,
  behind: 0,
  entries: [
    { path: "src/components/Cart.tsx", staged: null, unstaged: "modified" },
    { path: "src/App.tsx", staged: "modified", unstaged: null },
    { path: "src/lib/format.ts", staged: "new", unstaged: null },
    { path: "docs/architecture.md", staged: null, unstaged: "modified" },
  ],
};
