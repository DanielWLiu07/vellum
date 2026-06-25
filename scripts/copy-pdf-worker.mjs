// Vendors the pdf.js worker into /public so the viewer can load it same-origin
// (no external CDN dependency — keeps the service self-contained). Runs on
// predev / prebuild. Idempotent.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdf.worker.min.mjs");

try {
  await mkdir(join(root, "public"), { recursive: true });
  await copyFile(src, dest);
  console.log("[vellum] copied pdf.worker.min.mjs -> public/");
} catch (err) {
  console.error("[vellum] failed to copy pdf worker:", err.message);
  process.exit(1);
}
