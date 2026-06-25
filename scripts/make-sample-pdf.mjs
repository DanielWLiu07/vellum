// Generates public/sample.pdf — a small multi-page document for the live demo.
// No dependencies: assembles raw PDF objects and computes the xref offsets.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PAGES = [
  ["Vellum", "Secure document viewer", "This is a demo document rendered to canvas,", "watermarked, and locked against download."],
  ["Capability tokens", "The host app signs a short-lived token.", "It carries a presigned source URL,", "watermark text, permissions, and an expiry."],
  ["Zero-knowledge proxy", "The viewer holds no database and no", "storage credentials. It trusts a request", "only because the HMAC signature verifies."],
  ["Watermarking", "Every page is stamped with the viewer's", "identity, baked into the pixels so it", "survives screenshots and DOM edits."],
  ["Slideshow mode", "Use the toolbar to switch views, or the", "arrow keys to move between slides.", "Right-click and Ctrl/Cmd+S are disabled."],
];

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function contentStream(lines) {
  let body = "BT\n/F1 28 Tf\n72 720 Td\n";
  body += `(${esc(lines[0])}) Tj\n`;
  body += "/F1 14 Tf\n0 -36 Td\n";
  for (let i = 1; i < lines.length; i++) {
    body += `(${esc(lines[i])}) Tj\n0 -22 Td\n`;
  }
  body += "ET";
  return body;
}

// Object layout: 1=Catalog, 2=Pages, 3=Font, then per page: content + page.
const objects = [];
objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);

const pageObjNums = [];
let nextNum = 4;
const contentDefs = [];
for (let i = 0; i < PAGES.length; i++) {
  const contentNum = nextNum++;
  const pageNum = nextNum++;
  pageObjNums.push(pageNum);
  const stream = contentStream(PAGES[i]);
  contentDefs.push({ contentNum, pageNum, stream });
}

objects.push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjNums.length} >>`);
objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

for (const { contentNum, pageNum, stream } of contentDefs) {
  // contentNum object
  objects[contentNum - 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  // pageNum object
  objects[pageNum - 1] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
}

// Serialize with xref offsets.
let pdf = "%PDF-1.4\n";
const offsets = [];
for (let i = 0; i < objects.length; i++) {
  offsets[i] = Buffer.byteLength(pdf);
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(pdf);
const count = objects.length + 1;
pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
for (let i = 0; i < objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

await mkdir(join(root, "public"), { recursive: true });
await writeFile(join(root, "public", "sample.pdf"), pdf, "latin1");
console.log(`[vellum] wrote public/sample.pdf (${PAGES.length} pages)`);
