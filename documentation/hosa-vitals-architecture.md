# HOSA Vitals — Architecture Specification

> Companion to `hosa-member-platform/documentation/hosa-canada-platform-architecture.md`.
> That document specifies the **member platform** (membership, payments, chapters,
> events). This one specifies **Vitals**, the study service. Where the two meet —
> identity handoff, the secure viewer — this document is the authority on the
> Vitals side of the seam.

---

## 1. System Overview

Vitals is HOSA Canada's study and learning service: official modules, member-uploaded
resources, flashcards, quizzes with proctored exam mode, chapter rosters, and the
assignment of work from trainers to students.

**The defining architectural fact: Vitals has no accounts of its own.** It never sees
a password, never stores a credential, and cannot enumerate HOSA's membership. A
member is authenticated by the member platform, which mints a short-lived signed
identity token; Vitals verifies the signature and trusts the identity for the life of
a session cookie. Everything scoped — chapter resources, rosters, assignments,
attempt review — keys off that identity.

That constraint shapes the rest of the design. There is no user table to join
against, so the "directory" is a cache of members who have arrived at least once, and
several surfaces carry that limitation in their copy rather than pretending to
completeness they don't have.

### Core Capabilities

- Official HOSA **modules** — multi-block lessons (Google Slides/Docs, PDFs, written notes)
- Member-uploaded **resources** — PDFs, with a secure canvas viewer and per-member watermarking
- **Flashcard decks** and **quizzes**, including a lightweight advisory exam mode
- **Assignment** of any of the above to chapter members, with due dates
- **Study activity** tracking — what a member actually studied, independent of assignment
- **Moderation** — automatic classification plus a human review queue
- **Chapter roster** and role-scoped oversight for trainers, advisors and admins

### Explicit Non-Goals

| Not built here | Where it lives |
|---|---|
| Membership, payments, chapter registration | Member platform |
| Real proctored exam engine (lockdown, server-enforced integrity) | Member platform |
| Password auth, account recovery, MFA | Member platform |
| Email delivery | Member platform (Vitals has none — see §13) |

Exam mode in Vitals is deliberately **advisory**: it records integrity flags for a
reviewer, it does not attempt to prevent cheating. The real proctored engine belongs
to the member platform. Don't rebuild it here.

---

## 2. Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 16 (App Router, TypeScript) | Server Components + Server Actions; same stack as the member platform |
| **UI** | React 19 | Compiler-era lint rules are enforced (see §12) |
| **State** | In-memory `Map` stores + durable JSON snapshots | No database — see §4 for why, and the constraints it imposes |
| **Object storage** | Cloudflare R2 (S3-compatible), or AWS S3 | Uploaded bytes and store snapshots |
| **Moderation** | OpenAI moderations API | Text + rendered-page classification |
| **Tests** | Vitest (node environment) | 1,147 tests; `lib/` and `app/api/` only — no component tests |
| **Lint** | ESLint + React Compiler rules | `react-hooks/purity`, `set-state-in-effect` are errors |
| **Deploy** | Docker (`Dockerfile` at repo root) | Runs as a service alongside the member platform |

There is no ORM and no migration system. See §4.

---

## 3. Trust & Identity

### 3.1 Two token types, two different jobs

Vitals uses signed, self-contained tokens in two distinct places. They share a format
family but answer different questions, and conflating them is the easiest mistake to
make in this codebase.

| | Identity token | Capability token |
|---|---|---|
| Answers | **Who** the member is | **What** may be viewed |
| Prefix | `vid1.` | `v1.` |
| Minted by | Member platform (`lib/vitals.ts` there) | Member platform (`lib/content/viewer-token.ts` there) |
| Verified by | `lib/identity-token.ts` | `lib/token.ts` |
| Secret | `VITALS_AUTH_SECRET` | `VELLUM_TOKEN_SECRET` ↔ `CONTENT_VIEWER_SECRET` |
| Delivered via | `/api/auth/enter?token=…` → session cookie | URL **fragment** `/embed#t=…` |
| Lifetime | 8h default, clamped `[60s, 24h]` | Minutes |

The capability token rides in the fragment because browsers never send fragments to
the server, never log them, and never leak them via `Referer`.

### 3.2 Identity token format

```
vid1.<base64url(payload)>.<base64url(hmac-sha256)>
```

The HMAC covers `vid1.<base64url(payload)>`, so any tampering invalidates it.
Payload:

```ts
interface Identity {
  sub: string;          // HOSA user id — becomes the resource `owner`
  name: string;
  chapter: string;      // chapter ID (cuid) — the grouping key
  chapterName?: string; // display only; absent on legacy tokens
  role: "student" | "trainer" | "advisor" | "admin";
  iat: number;
  exp: number;
}
```

**`chapter` and `chapterName` are two fields on purpose.** `chapter` is the identity
and the only thing anything groups, filters or compares on — it must stay an id, or
renaming a chapter orphans its roster. `chapterName` is for display. Never render
`chapter`; never group by `chapterName`. Both apps carry this note because collapsing
them is a tempting simplification that silently breaks every existing comparison.

### 3.3 The request gate

`proxy.ts` is the gate. Without it, `getViewer()` falls back to a standalone demo
profile whenever there is no session — so on a deployment with `VELLUM_DEMO_MODE=1`
(which the product needs set to function at all) an anonymous visitor arrived holding
a working identity on a real chapter.

The gate is **only active once `VITALS_AUTH_SECRET` is configured**. With no secret
there is no host app to authenticate against, and the app stays the standalone local
demo it was built as — there the fallback profile is the point, not a hole.

### 3.4 Roles

Four roles, coarser than HOSA's. The member platform maps its own roles down when
minting (`SUPER_ADMIN`/`ADMIN` → `admin`; `ADVISOR`/`PRESIDENT` → `advisor`;
`TRAINER` → `trainer`; everything else → `student`).

| Role | Can assign | Sees roster | Authors modules | Admin console |
|---|---|---|---|---|
| `student` | — | own chapter (reduced) | — | — |
| `trainer` | own chapter | own chapter | — | — |
| `advisor` | own chapter | own chapter | — | — |
| `admin` | anyone | all chapters | yes | yes |

`canAssign(role)` in `lib/users.ts` is the authority. `components/use-assignments.ts`
carries a **client mirror** of it for presentation only — every route re-decides
against the signed session, so a viewer who flips the role switcher gets buttons that
then refuse them, never access.

### 3.5 The preview switcher is not authorization

The dashboard sidebar has a **PREVIEW AS** control. Two different notions of "role"
live in `components/dashboard.tsx`, and conflating them was a hole a student could
walk through:

- **`role`** — what the switcher is previewing. Round-trips through `?role=`. Anyone
  can set it to `admin`. It decides which menu is drawn, nothing more.
- **`access`** — what the signed session says, via `/api/auth/me`. The only thing
  allowed to gate an admin surface.

`adminControls = access === "granted" && role === "admin"`. Intersecting them can only
ever take access away.

The dashboard adopts the **signed** role on first load (`roleToAdopt` in `lib/nav.ts`),
so an admin lands on the admin console rather than the student menu. An explicit
`?role=` always wins.

---

## 4. Data Model

### 4.1 Entity Relationships

There are no foreign keys — these are the relationships the code maintains by hand,
and the ones a change has to keep true.

```
HOSA Member Platform (the host — owns identity)
  │
  │ signed identity token (vid1) ──▶ /api/auth/enter
  ▼
Identity { sub, chapter, chapterName, role }
  │
  ├── KnownUser ......... cached in `users` on first arrival; the whole directory
  │     └── keyed by sub, grouped by chapter
  │
  ├── owns ── Resource (any of four kinds, all `owner: sub`)
  │             ├── Module ......... admin-authored; Sections → Subsections → Blocks
  │             │                     Block = GoogleBlock | PdfBlock | InfoBlock
  │             ├── Doc ............ uploaded PDF; bytes in object storage,
  │             │                     metadata in `resource-meta`
  │             ├── Deck ........... flashcards
  │             └── Quiz ........... questions + optional ExamSettings
  │                   └── QuizAttempt (taker: sub, score, IntegrityFlag[])
  │
  ├── ShareState ........ sidecar keyed by resource id, NOT embedded
  │     └── { visibility, chapter, people: PersonShare[] }
  │
  ├── Assignment ........ { kind, refId, assigneeId, assignedBy, chapter, dueAt }
  │     └── chapter is snapshotted AT ASSIGN TIME — it scopes oversight
  │
  ├── StudyEvent ........ member × content × time; independent of Assignment
  │
  └── QueueEntry ........ moderation; reason ∈ flagged | unchecked | reported | submitted
```

**Two joins worth naming.** `ShareState` is a sidecar rather than a field on each
resource, so visibility can be reasoned about in one place (`lib/resource-share.ts`)
and composed in at read time by `withScope`. And `Assignment.chapter` is a snapshot,
not a lookup — it is what scopes a trainer's oversight, so it must not move if the
member later changes chapter.

### 4.2 There is no database

State lives in in-memory `Map`s, snapshotted as JSON. `lib/persist.ts` writes each
snapshot to, in priority order:

1. **Object storage** (S3 / R2) when configured — durable in production
2. **Local filesystem** `.data/<key>.json` — durable across `next dev` restarts
3. **Nowhere** — tests and read-only filesystems

Stores call `saveSnapshot()` after each mutation (debounced and coalesced, so a burst
collapses into one write) and `loadSnapshot()` once at hydration. `lib/durable.ts`
holds the hydration registry; `lib/bootstrap.ts` imports every store so hydrators are
registered before `ensureReady()` runs.

**Consequences you must design around:**

- Writes are last-write-wins. There are no transactions and no referential integrity.
- Snapshots are small JSON documents. Binary uploads never go here — they belong in
  the object-storage upload backend.
- Without object storage configured, **production data does not survive a restart**.
  `warnIfEphemeralStorage()` exists for exactly this reason.
- Horizontal scaling is not supported as built: two instances would each hold their
  own map and overwrite each other's snapshots.

### 4.3 Persisted stores

| Key | Module | Holds |
|---|---|---|
| `users` | `lib/users.ts` | Directory of members who have entered at least once |
| `modules` | `lib/modules.ts` | Official lessons (admin-authored) |
| `decks` | `lib/decks.ts` | Flashcard decks |
| `quizzes` | `lib/quizzes.ts` | Quizzes and exam settings |
| `quiz-attempts` | `lib/quiz-attempts.ts` | Exam attempts + integrity flags |
| `assignments` | `lib/assignments.ts` | Work handed out, per member |
| `resource-meta` | `lib/resource-meta.ts` | Uploaded-document metadata |
| `resource-share` | `lib/resource-share.ts` | Visibility + per-person grants sidecar |
| `folders` | `lib/folders.ts` | Resource organisation |
| `moderation-queue` | `lib/moderation-queue.ts` | Held/flagged/reported content |
| `thumbnails` | `lib/thumbnails.ts` | Rendered page previews |
| `settings` | `lib/settings.ts` | Per-member preferences |
| `share-bans` | `lib/share-ban.ts` | Sharing restrictions |
| `nums` | `lib/publish.ts` | Monotonic sequence numbers |

### 4.4 The member directory

`lib/users.ts` remembers every identity that has arrived. This is the closest thing to
a user table, and its limitation is load-bearing:

> **Vitals only knows members who have opened it at least once from the HOSA member
> platform.**

A trainer cannot assign to a student who has never visited. Several surfaces state
this in the UI rather than rendering a misleadingly short roster. Do not "fix" it by
inventing members — the fix is a roster sync from the member platform (§13).

### 4.5 Content model — modules

A module is sections → subsections → **blocks**. Blocks are a discriminated union, so
a subsection can stack an embedded deck on top of a PDF on top of a written note:

```ts
type BlockKind = "slides" | "doc" | "pdf" | "info";

interface GoogleBlock { id: string; kind: "slides" | "doc"; slidesId: string; slidesPub: boolean }
interface PdfBlock    { id: string; kind: "pdf";  docId: string }
interface InfoBlock   { id: string; kind: "info"; markdown: string }

type Block = GoogleBlock | PdfBlock | InfoBlock;

interface Subsection { id: string; title: string; blocks: Block[] }
```

Older single-content subsections are normalised to a one-block array at the read
boundary, so callers only ever see `blocks`.

**`sample-module` is immutable.** `updateModule` returns `undefined` and
`deleteModule` returns `false` for it, with tests pinning both. The editor's "it
doesn't exist, or you're not an admin" refusal covers this case too.

---

## 5. Visibility & Sharing

`lib/visibility.ts` holds the access rules. It is pure — no I/O, no request context —
so identical rules run on client and server.

```ts
type Visibility = "public" | "chapter" | "private";
type ShareRole  = "viewer" | "editor";
```

```ts
canView(r, v)  = v.admin
              || r.owner === v.owner
              || r.people?.some(p => p.person === v.owner)
              || r.visibility === "public"
              || (r.visibility === "chapter" && r.chapter === v.chapter)
```

`canEdit` and `canManageSharing` layer on top. **These functions ARE the access rules,
not a convenience for the UI.** A viewer is always passed in explicitly and always
comes from the signed session — nothing here falls back to a demo identity.

`Viewer.owner`, `Scoped.owner` and `chapter` are HOSA identity cuids. They are for
comparing, never for displaying; use `makeNameResolver` / `chapterLabel`.

---

## 6. Assignments

Any of the four content kinds can be assigned:

```ts
type AssignmentKind = "doc" | "deck" | "quiz" | "module";
type AssignmentStatus = "todo" | "done";
```

The assignee's chapter is resolved from the **signed user directory**, not from the
request and not from the member's editable profile — so "assign cross-chapter" cannot
be arranged by editing a profile field.

**Scoping, which is the platform-wide pattern for oversight:**

| Caller | Sees |
|---|---|
| student | their own, and only their own |
| trainer / advisor | every assignment in **their** chapter |
| admin | all of them |

`?assignee=` narrows but never widens.

Surfaces: **My chapter** (per-member Assign button) hands work out; **Assigned work**
(`components/assigned-work-view.tsx`) is the read of what went out, grouped by member,
filterable by outstanding / overdue / done.

---

## 7. Study Activity

One fact, recorded once: *this member did this thing with this content at this time.*

Before `lib/study-activity.ts`, the only "I did this" in the system was
`completeAssignment` — which only exists if a trainer handed the work out. A student
studying on their own left no trace, module progress lived in `localStorage` (per
browser, invisible to everyone), and closing a flashcard drill forgot every card.

Study events are the substrate for progress, spaced repetition and the roster's
completion counts. They are independent of assignment on purpose.

---

## 8. Moderation

Content that cannot be cleared outright is **stored but held at `private` visibility**
and queued for a human. The earlier design refused with a 422 and dropped the bytes,
which made false positives unrecoverable and left an admin able to see that
*something* was blocked but never what.

| Queue reason | Meaning | Held private? |
|---|---|---|
| `flagged` | The model tripped a category | yes |
| `unchecked` | Moderation was configured but did not run — over a size cap, a page wouldn't render, or the API timed out | yes |
| `reported` | A member said this content is a problem | **no** |
| `submitted` | Awaiting publish approval | yes |

`unchecked` exists because a skipped moderation result is `allowed: true` and was
therefore indistinguishable from "clean".

**A report never pulls content offline.** One member must not be able to hide
another's work by pressing a button — that is the reviewer's call, and until they make
it the material stays up. The compensating control is triage order: reported items are
shown to reviewers first.

Reporting (`/api/report`) is deliberately **not** the same as feedback
(`/api/feedback`). Feedback is a message to staff, answered by correcting something. A
report is an accusation about content, answered by a moderation decision, and lands in
the same queue as automatic flags rather than an inbox nobody drains.

---

## 9. API Reference

All routes are `runtime: "nodejs"`, `dynamic: "force-dynamic"`, and answer
`404 {"error":"dashboard_disabled"}` unless `VELLUM_DEMO_MODE=1`.
Authentication is the `vitals_session` cookie. Errors are `{ "error": "<code>" }`.

### 9.1 Auth

| Route | Method | Notes |
|---|---|---|
| `/api/auth/enter?token=<vid1…>` | GET | Verifies the identity token, sets `vitals_session`, 307s to `/dashboard` |
| `/api/auth/me` | GET | `{signedIn, id, name, chapter, chapterName, role}` or `{signedIn:false, authConfigured}` |
| `/api/auth/logout` | POST | Clears the session |
| `/api/auth/demo` · `/api/demo-token` | GET | Local standalone demo only |

### 9.2 Content

| Route | Method | Access | Response |
|---|---|---|---|
| `/api/modules` | GET | any member | `{modules}` |
| `/api/modules` | POST | **admin** | created module |
| `/api/modules/[id]` | GET/PATCH/DELETE | GET any · writes **admin** | `sample-module` refuses writes |
| `/api/docs` | GET | any member | visibility-filtered |
| `/api/doc/[id]` | GET/PATCH/DELETE | `canView` / `canEdit` | |
| `/api/doc/[id]/preview` | GET | `canView` | rendered page image |
| `/api/decks`, `/api/quizzes` | GET/POST | any member | |
| `/api/decks/[id]`, `/api/quizzes/[id]` | GET/PATCH/DELETE | `canView` / `canEdit` | |
| `/api/*/[id]/copy` | POST | `canView` | duplicates into caller's ownership |
| `/api/upload` | POST | any member | runs moderation; may queue |

### 9.3 Quizzes & attempts

| Route | Method | Access | Notes |
|---|---|---|---|
| `/api/quizzes/[id]/grade` | POST | taker | records an attempt |
| `/api/quizzes/[id]/answers` | GET | owner/admin | answer key |
| `/api/quizzes/[id]/attempts` | GET | owner/admin → **all**; trainer/advisor → **own chapter's takers** | `{attempts, scope}`; requires `canView` on the quiz |
| `/api/quizzes/[id]/attempts` | PATCH | **owner/admin only** | void / reinstate |
| `/api/my-attempts` | GET | self only | No `?owner=` parameter exists, deliberately |

Chapter scoping on the GET is enforced by **filtering rows**, not by widening the
door: a trainer on a quiz shared across chapters sees their own members and nobody
else's. A taker the directory doesn't know is omitted rather than included.

### 9.4 Assignments

| Route | Method | Body / query | Notes |
|---|---|---|---|
| `/api/assignments` | GET | `?assignee=` | `{assignments, scope}` where scope ∈ `self` \| `chapter` \| `all` |
| `/api/assignments` | POST | `{kind, refId, assigneeId, dueAt?}` | trainer/advisor/admin; chapter-checked |
| `/api/assignments/[id]` | PATCH | `{status:"done"}` | assignee only |
| `/api/assignments/[id]` | DELETE | — | assigner or admin |

### 9.5 Oversight & moderation

| Route | Method | Access | Notes |
|---|---|---|---|
| `/api/roster` | GET | any member | `{roster, scope}`; students get a reduced people-only roster (`limited: true`) |
| `/api/moderation` | GET/POST | **admin** | `{configured, pending}`; POST approves/rejects |
| `/api/report` | POST | any member | `{kind, id, reason}` → `{ok, id}`. Flat body, not nested |
| `/api/feedback` | POST | any member | member → staff message |
| `/api/feedback` | GET/PATCH | **admin** | list; resolve/reopen |
| `/api/audit` | GET | **admin** | audit log |
| `/api/comments` | GET/POST/DELETE | `canView` | public discussion on a resource |

### 9.6 Member

| Route | Method | Notes |
|---|---|---|
| `/api/profile` | GET/PATCH | `role` is **not** patchable — that was a self-escalation path |
| `/api/settings` | GET/PATCH | preferences |
| `/api/favorites` | GET/POST | |
| `/api/study` | POST/GET | record a study event · `{entries}` |
| `/api/study/progress` | GET/DELETE | derived progress |
| `/api/folders`, `/api/folders/[id]` | GET/POST/PATCH/DELETE | |
| `/api/share` | POST | visibility + per-person grants |
| `/api/images`, `/api/images/[id]` | POST/GET | inline card images |
| `/api/proxy` | POST | server-side fetch; SSRF-guarded (see §12) |

---

## 10. Storage

`lib/storage/` abstracts three backends behind one interface: `r2`, `s3`, `memory`.
`storageBackendName()` reports which is live; `storageHealth()` is used by the admin
console; `warnIfEphemeralStorage()` shouts when neither object store is configured.

Uploaded bytes never enter the JSON snapshots. If R2/S3 is unconfigured, uploads live
in memory and **vanish on restart** — acceptable locally, a data-loss bug in
production.

---

## 11. Navigation & Roles

`lib/nav.ts` is the single definition, read by both the sidebar and the dashboard's
section validation.

| Role | Sections |
|---|---|
| student | chapter, home, assignments, modules, resources, quizzes, results, skills |
| trainer | chapter, **assigned**, lessons, modules, **resources**, flashcards, quizzes, results, skills |
| advisor | chapter, home, assignments, **assigned**, modules, resources, quizzes, results, lessons, skills |
| admin | chapter, overview, users, **assigned**, modules, content, moderation, access, activity, settings |

Plus `COMMON_LINKS` (guidelines, feedback, upload, profile) on every menu.

`DEFAULT_SECTION` pins where each role **lands**, deliberately not "the first item" —
"My chapter" heads every list for reachability, but opening the dashboard should put
you on your own work.

Sections shared by every role (`guidelines`, `modules`, `feedback`, `chapter`,
`assigned`) render once in `SHARED_SECTIONS`; the server decides their scope, so one
view serves all four roles.

---

## 12. Security Invariants

Do not weaken these without understanding what they cost:

1. **`role` is not patchable via `/api/profile`.** It comes from the signed token.
2. **The preview switcher never grants.** Always intersect with `access`.
3. **Attempt review filters rows, never widens the door** (§9.3).
4. **Existence is not leaked.** An unviewable resource and a missing one both answer
   404, so endpoints can't be walked to discover ids.
5. **Capability tokens ride in the URL fragment**, never the query string.
6. **A report never quarantines.** Only a reviewer takes content down.
7. **`/api/proxy` revalidates on redirect** and enforces private-host blocking plus
   streaming byte limits — a declared `content-length` is not trusted.
8. **React Compiler rules are errors.** `Date.now()` during a client render is a
   purity violation; read the clock in an effect or on the server.

---

## 13. Known Gaps

Ordered by what actually blocks members.

### 13.1 No notification system — mostly closed

**In-app notification now exists** (`lib/notifications.ts`, `/api/notifications`,
the bell in the top bar). Assigning raises one for the assignee; completing or
reopening raises one for the trainer; an admin can send one by hand. Due dates
raise `assignment.due_soon` / `assignment.overdue` via a lazy sweep
(`lib/due-sweep.ts`), because Vitals has no scheduler and inventing one would be
a lie.

**Still open, and it is the half that matters for a member who is not looking:**
there is no email. The sweep runs when a member reads their own work, so someone
who never opens Vitals is still never told. The bell shows everything the moment
they arrive, which is a real improvement over silence — but "due dates pass
silently" is only half-solved, and this gap should not be ticked off as done.
Email, or an explicit decision to route through the member platform's Resend
integration, is what closes it.

### 13.2 Blocked on external configuration

| Gap | Effect | Owner |
|---|---|---|
| `OPENAI_API_KEY` returning **429** | Nothing is auto-classified; uploads queue as `unchecked` and every one needs human review | account credits |
| R2 credentials absent | Uploads do not survive a restart | Frank |

The 429 degrades honestly — content queues rather than passing through unchecked —
but the queue is only as useful as the person draining it.

### 13.3 Structural

- **Roster completeness.** Only members who have opened Vitals are known (§4.4). A
  roster sync from the member platform would fix it properly.
- **Single-instance only.** The store design (§4.2) cannot be scaled horizontally.
- ~~**Identity token TTL is 8h.**~~ **Done — cut to 120s.** The lockstep warning
  that used to sit here was wrong, and worth recording why: it assumed a short
  handoff token would produce a short session. It does not. `/api/auth/enter`
  verifies the incoming token and then mints a **fresh** session cookie on its
  own `SESSION_TTL_SECONDS`, never inheriting `exp`. Cutting the mint TTL is a
  one-sided change on the platform. Verified end to end across both repos: a
  120s token is accepted and the resulting session cookie is still `Max-Age=28800`.
  `lib/identity-token.test.ts` now pins that independence so it stays true.
- **No component tests.** Vitest runs in the `node` environment; `lib/` and
  `app/api/` are well covered, React components are not covered at all.

### 13.4 Product decisions outstanding — MUST be settled before Phase 1

- **Official practice tests** — scope undecided.
- ~~**Integration status.**~~ **This entry was false and is withdrawn.** It said
  the member platform had removed `lib/vitals.ts` and `app/(dashboard)/study/route.ts`
  and that there was no route into Vitals from the main site. In the current
  checkout all of it exists and is wired: `lib/vitals.ts`, the `/study` route
  calling `vitalsEnterUrl`, `lib/auth/external-handoff.ts` (which exists
  specifically to special-case `/study` as an off-origin hop), and two passing
  test files covering the handoff. The Phase 0 question this blocked was already
  answered. What IS true is narrower: no navigation link points at `/study`, so
  the route is reachable only by typing it.

---

## 14. Development Roadmap (Phased)

Phases are ordered by what unblocks members, not by what is interesting to build.
Nothing in Phase 1 is speculative — each item closes a gap named in §13.

### Phase 0 — Decide (blocking)
- [x] ~~Settle whether Vitals stays in the product (§13.4)~~ — the premise was
      wrong. The `/study` handoff was never removed; see §13.4. Nothing below is
      blocked on it. Remaining: add a navigation link to `/study`, which is the
      real gap
- [ ] Scope "official practice tests" — what counts as official, who authors them
- [ ] Top up the OpenAI account, or accept that every upload needs human review

### Phase 1 — Make assignment actually work (Weeks 1–2)
- [x] Notification primitive in `lib/` — `lib/notifications.ts`, storage-backed,
      with actor-based self-suppression and burst collapsing
- [x] Notify on assign, on due-soon, on overdue — the last two via the lazy
      sweep in `lib/due-sweep.ts`, since there is no scheduler
- [x] Unread indicator in the dashboard shell — the bell in `app-topnav`
- [ ] Email delivery, or an explicit decision to route notifications through the
      member platform's Resend integration instead of adding one here.
      **Still the one that matters** — see §13.1
- [x] Tests: covered in `lib/notifications.test.ts` and `lib/due-sweep.test.ts`

### Phase 2 — Close the data gaps (Weeks 3–4)
- [ ] Roster sync from the member platform, so a trainer can assign to a student who
      has never opened Vitals (§4.4)
- [ ] Provision R2 in production; verify uploads survive a restart
- [x] Cut the identity-token TTL — done, 120s, and no lockstep was needed; the
      warning that used to be here rested on a false premise (§13.3)
- [ ] Drain the moderation queue; confirm `unchecked` returns to zero once the API key works

### Phase 3 — Coverage and scale (Weeks 5–7)
- [ ] jsdom environment + component tests; the React layer currently has none
- [ ] Replace the in-memory store with a real database, or document single-instance
      deployment as a permanent constraint (§4.2)
- [ ] Study-activity reporting for trainers: what a student actually studied, not
      just what was assigned and ticked

### Phase 4 — Post-launch
- [ ] Spaced repetition surfaced to the member, driven by the study events already recorded
- [ ] Trainer-authored modules (admin-only today by design — revisit deliberately)
- [ ] Bulk assignment to a whole chapter or a filtered subset

---

## 15. Environment

| Variable | Required | Purpose |
|---|---|---|
| `VITALS_AUTH_SECRET` | for the gate | Shared HMAC secret for identity tokens (≥16 chars). Must match the member platform. **Without it the request gate is inactive** |
| `VELLUM_DEMO_MODE` | yes (`1`) | Enables the dashboard; every API 404s without it |
| `VELLUM_TOKEN_SECRET` | for the viewer | Capability-token secret; must equal the host's `CONTENT_VIEWER_SECRET` |
| `VELLUM_FRAME_ANCESTORS` | for embedding | CSP allow-list for the host that frames `/embed` |
| `R2_ENDPOINT` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | production | Object storage |
| `S3_BUCKET` · `S3_REGION` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | alternative | S3 instead of R2 |
| `OPENAI_API_KEY` | for moderation | Without it, uploads queue as `unchecked` |

**Do not rename `VELLUM_*` variables.** The repo is still named `vellum` and the
member platform's deployment config matches these names; a rename is a production
outage on both sides. The service is called HOSA Vitals; the variables are not.

---

## 16. Repository Layout

```
app/
  api/…                 42 route handlers (§9)
  dashboard/            the shell; role menus render here
  modules/[id]/         module player + admin editor
  quizzes/[id]/         take, edit, attempts review
  decks/[id]/           flashcard drill + editor
  view/[id]/            secure document viewer
  embed/                capability-token entry point (fragment)
  upload/  profile/  guidelines/  signed-out/
components/             React; dashboard.tsx is the role/section router
lib/                    stores, access rules, tokens, moderation (~60 modules)
  storage/              r2 · s3 · memory backends
proxy.ts                the request gate (§3.3)
scripts/                sample PDF generation, pdf worker copy
documentation/          this file
```

### Conventions

- Tests sit **next to** the code (`lib/foo.ts` + `lib/foo.test.ts`), not in a
  separate tree.
- `__reset*()` helpers exist on every store for test isolation.
- Comments explain **why**, especially where a previous design failed — several
  carry the incident that motivated the current shape. Preserve them; they are the
  reason the code isn't simpler.
