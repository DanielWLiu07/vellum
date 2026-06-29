# Vitals

**A stateless, zero-knowledge secure document viewer microservice.**

Embed gated PDFs in any app with per-user watermarking and download prevention — without handing the viewer your database, your storage credentials, or your users. Vitals serves exactly one document, to one holder of one signed token, for a few minutes, and nothing else.

[![CI](https://github.com/DanielWLiu07/vellum/actions/workflows/ci.yml/badge.svg)](https://github.com/DanielWLiu07/vellum/actions/workflows/ci.yml)

`Next.js 16` · `pdf.js` · `HMAC capability tokens` · `MIT`

---

## The problem

You have paid/gated content — course PDFs, member handbooks, exam papers — and you want to:

- show it **in the browser**, not hand out a downloadable file;
- make leaked screenshots **traceable** to whoever leaked them;
- expire access automatically;
- do all of this **without** giving a third-party viewer access to your data store.

Naïvely embedding `<iframe src="https://bucket/doc.pdf">` fails every one of those: the raw URL is right there in the network tab, it doesn't expire, there's no watermark, and the browser's native PDF toolbar has a download button.

## The approach

Vitals splits the work across a **trust boundary** sealed by a signed capability token. Your app stays the source of truth for *who can see what*; Vitals is a dumb, stateless renderer that only acts on a cryptographically valid grant.

```
   ┌─────────────────────────┐                    ┌──────────────────────────┐
   │   YOUR APP (the host)    │                    │   VELLUM (the viewer)    │
   │                          │                    │                          │
   │  1. user requests doc    │                    │   holds NO database      │
   │  2. check membership ────┼── you own this     │   holds NO storage keys  │
   │  3. presign R2/S3 URL    │                    │   knows ONE doc at a time│
   │  4. mintToken({          │                    │                          │
   │       src, watermark,    │   capability token │                          │
   │       perms, exp })  ────┼───────────────────▶│  5. verify HMAC sig      │
   │                          │   (in URL fragment)│  6. proxy-fetch the doc  │
   │  <iframe                 │                    │     server-side          │
   │    src="…/embed#t=…">    │◀───────────────────┼  7. render to <canvas>   │
   │                          │   watermarked pages│     + bake watermark     │
   └─────────────────────────┘                    └──────────────────────────┘
```

1. **Your app** checks access (membership, consent, whatever), presigns a short-lived storage URL, and wraps it in an HMAC-signed token carrying the source URL, watermark text, permissions, and an expiry.
2. **Your app** frames `…/embed#t=<token>`. The token rides in the URL **fragment** — browsers never send fragments to a server, so it stays out of access logs and `Referer` headers.
3. **Vitals** verifies the signature (constant-time), then fetches the document **server-side** through its proxy. The presigned URL never reaches the browser, so it can't be lifted from the network tab and replayed.
4. **Vitals** renders pages to `<canvas>` with pdf.js — never an `<embed>`/`<object>` pointed at the raw file — and bakes a tiled, diagonal watermark into the page pixels.

## Why "zero-knowledge"

Vitals has no database and no storage credentials. It can't enumerate your documents or your users, and a compromise of the viewer leaks nothing but whichever single document a live token happens to point at. Rotating `VELLUM_TOKEN_SECRET` instantly invalidates every outstanding link.

## What it is — and honestly isn't

No in-browser viewer can make bytes truly un-extractable: if a page renders, the pixels exist, and a determined user can screenshot or photograph the screen. Vitals doesn't pretend otherwise. What it does is raise the bar to the industry-standard "good enough":

- **no raw file URL is ever exposed** to the client;
- **links expire** (default 15 min), so a copied embed URL dies quickly;
- **every page is watermarked** with the viewer's identity, baked into the pixels — so a leaked screenshot points back at who leaked it;
- **download / print / right-click / `Ctrl·Cmd+S`** are disabled unless the token explicitly grants them.

The result deters casual copying and makes redistribution *accountable*, which for most gated-content use cases is the actual goal.

## Security model

| Threat | Mitigation |
|---|---|
| Forged / tampered token | HMAC-SHA256 over `version.payload`, verified constant-time |
| Stolen embed URL replayed later | Short token expiry (default 15 min, clamped 30s–1h) |
| Source URL lifted from network tab | Document is proxy-fetched server-side; `src` never sent to browser |
| Token leaked via logs / `Referer` | Token travels in the URL **fragment**, not the query/path |
| Viewer compromise | Stateless — no DB, no storage keys; blast radius is one live doc |
| SSRF via a leaked secret (token `src` → internal host) | Proxy refuses non-http(s) and private/loopback/link-local hosts (defense-in-depth behind the HMAC) |
| Clickjacking / unwanted embedding | `Content-Security-Policy: frame-ancestors` allowlist on `/embed` |
| Mass link invalidation needed | Rotate the shared secret — all outstanding tokens die instantly |
| Leaked screenshot redistributed | Per-user watermark baked into page pixels (survives DOM edits) |

## Viewer controls

- **Scroll** and **slideshow** modes (the host can default to slides via `&mode=slides`).
- **Fit-to-width** (default, recomputed on resize) and **zoom** in/out.
- **Full screen**.
- **Download** / **Print** buttons appear *only* when the token grants
  `perms.download` / `perms.print` — a locked-down token shows neither, and print
  goes through a stylesheet that keeps the watermark.
- **Keyboard:** `←` / `→` / `Space` page through slideshow, `+` / `-` zoom,
  `f` toggles full screen. `Ctrl`/`Cmd`+`S` and right-click are blocked; `Cmd`+`P`
  is blocked unless printing is granted.

## Quickstart

```bash
git clone https://github.com/DanielWLiu07/vellum
cd vellum
npm install
cp .env.example .env            # set VELLUM_TOKEN_SECRET (openssl rand -hex 32)
npm run dev                     # http://localhost:3000 — live demo on the landing page
```

```bash
npm test           # token mint/verify/tamper/expiry suite
npm run lint       # eslint (flat config)
npm run build      # production build
```

### Docker (self-hosting)

Vitals deploys natively on Vercel — Docker isn't required there. For self-hosting,
a multi-stage `Dockerfile` builds the Next.js standalone output:

```bash
docker build -t vellum .
docker run -p 3000:3000 -e VELLUM_TOKEN_SECRET=$(openssl rand -hex 32) -e VELLUM_DEMO_MODE=1 vellum
```

## Integrating with your app

Share one secret between your app and Vitals, mint a token with the same `lib/token.ts`, and frame the viewer.

```ts
import { mintToken } from "vellum/lib/token"; // or copy lib/token.ts into your app

// In your gated route, AFTER you've confirmed the user may see this document:
const presignedUrl = await presignStorageGet(doc.key, { expiresIn: 900 }); // your R2/S3
const token = mintToken(process.env.VELLUM_TOKEN_SECRET!, {
  src: presignedUrl,
  watermark: `${user.name} • ${user.email}`,
  perms: { download: false, print: false, copy: false },
  ttlSeconds: 900,
});

const viewerSrc = `https://viewer.example.com/embed#t=${encodeURIComponent(token)}`;
// optionally add &mode=slides for slideshow presentation
```

```tsx
<iframe src={viewerSrc} sandbox="allow-scripts allow-same-origin" />
```

Set `VELLUM_FRAME_ANCESTORS` on the Vitals deployment to your app's origin(s) so only you can embed it.

## API

| Route | Method | Purpose |
|---|---|---|
| `/embed#t=<token>[&mode=slides]` | GET | The embeddable viewer surface |
| `/api/proxy` | POST `{ t }` | Verifies the token, streams the document bytes |
| `/api/demo-token` | GET | Demo only (gated by `VELLUM_DEMO_MODE`) — mints a token for the sample doc |

### `lib/token.ts`

- `mintToken(secret, { src, watermark?, perms?, ttlSeconds?, jti? }) → string`
- `verifyToken(secret, token, now?) → { ok: true, claims } | { ok: false, reason }`

Reasons: `malformed` · `bad_version` · `bad_signature` · `expired`.

## Configuration

| Env var | Required | Description |
|---|---|---|
| `VELLUM_TOKEN_SECRET` | yes | Shared HMAC secret (32+ bytes). Must match the host app. |
| `VELLUM_FRAME_ANCESTORS` | no | Space-separated origins allowed to iframe `/embed`. Default `'self'`. |
| `VELLUM_DEMO_MODE` | no | `1` enables the public landing demo + `/api/demo-token`. |
| `R2_ENDPOINT` | no | Cloudflare R2 (S3-compatible) endpoint for dashboard uploads, e.g. `https://<account>.r2.cloudflarestorage.com`. |
| `R2_BUCKET` | no | R2 bucket name for dashboard uploads. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | no | R2 credentials. |

**Dashboard upload storage.** This applies only to standalone **dashboard mode**
(`VELLUM_DEMO_MODE=1`). Uploads default to an in-memory store (ephemeral). Set
**all four** `R2_*` vars to persist them in Cloudflare R2 instead (works against
AWS S3 too — point `R2_ENDPOINT` at the S3 endpoint). The **embedded**,
zero-knowledge mode never touches storage — the host app owns the bytes.

## Tech

Next.js 16 (App Router) · React 19 · pdf.js (`pdfjs-dist`) · Node `crypto` for HMAC · Vitest. No runtime dependencies beyond pdf.js — the token layer is dependency-free and portable into any Node host.

## License

MIT © Daniel W Liu
