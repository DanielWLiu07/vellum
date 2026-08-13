/**
 * AI content moderation via OpenAI's free moderation endpoint.
 *
 * Study material that users author is run through `omni-moderation-latest`
 * before it is stored. The model is multimodal, so both TEXT (deck cards, quiz
 * questions, titles) and IMAGES (card/question pictures, image uploads) can be
 * checked.
 *
 * FREE TO CALL, BUT NOT ON A ZERO BALANCE. OpenAI does not charge for this
 * endpoint, which reads as "no billing needed" and isn't: an account with no
 * credit is refused, and refused as a bare 429 "Too Many Requests" with no
 * rate-limit headers and no error code. That is indistinguishable from real
 * throttling — /v1/chat/completions returns the actual cause
 * (credit_balance_exhausted) for the same account state, and /v1/models still
 * answers 200, so the key looks fine throughout. Diagnose with
 * `node scripts/moderation-probe.mjs`, which knows this and says so.
 *
 * What this module returns:
 *   - No OPENAI_API_KEY   -> SKIPPED (checked: false, allowed).
 *   - API error / timeout -> SKIPPED (checked: false, allowed), and recorded
 *     as a failed call so moderationHealth() can report the outage.
 *   - Content flagged     -> flagged, with the tripped category names.
 *
 * What CALLERS do with that is not decided here, and differs by route. The
 * upload path routes both `flagged` and `checked: false` through
 * lib/moderation-gate, which quarantines rather than admitting — so a skipped
 * check becomes review latency, not a hole. Other create paths still treat
 * `allowed` as permission to store, which means a SKIPPED result sails through
 * as if examined. Don't read the values below as the platform's posture; read
 * the caller's.
 */

/**
 * Overridable so the pipeline can be exercised against a stub.
 *
 * Worth having beyond testing: the endpoint is free per call, but OpenAI still
 * refuses it on a zero credit balance — and refuses it with a bare "Too Many
 * Requests" rather than the real reason, so the failure looks like throttling.
 * Being able to point this somewhere else is how you tell "our integration is
 * broken" apart from "their billing is".
 */
const ENDPOINT = `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/moderations`;
const MODEL = "omni-moderation-latest";
// The endpoint truncates long text; cap what we send to keep latency sane.
const MAX_INPUT_CHARS = 40_000;
// Skip image moderation above this size: the base64 payload gets large and the
// endpoint rejects very big images anyway. Fail-open (allowed) past the cap.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

export interface ModerationResult {
  /** true when the content may be stored (allowed or moderation skipped). */
  allowed: boolean;
  /** true when the moderation model flagged the content. */
  flagged: boolean;
  /** Category names that tripped (e.g. "violence", "hate"), empty otherwise. */
  categories: string[];
  /** false when moderation did not actually run (no key, skip, or API error). */
  checked: boolean;
}

type InputItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const SKIPPED: ModerationResult = { allowed: true, flagged: false, categories: [], checked: false };
const CLEAN: ModerationResult = { allowed: true, flagged: false, categories: [], checked: true };

export function moderationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ---- liveness ------------------------------------------------------------
//
// `configured` only says a key is present, and that was the whole of the admin
// indicator. When the endpoint started answering 429, every call fail-opened to
// SKIPPED, the gate correctly quarantined instead of admitting — and the
// console still read "AI moderation: On, 0 items blocked", which looks like a
// healthy quiet system rather than one examining nothing. Recording outcomes is
// what makes "on" and "working" different claims.

interface CallStats {
  calls: number;
  failures: number;
  lastOk: boolean;
  lastFailureAt?: number;
  /** HTTP status of the last failed call; absent when it failed before a response. */
  lastStatus?: number;
}

const statsHolder = globalThis as unknown as { __vitalsModStats?: CallStats };
const stats: CallStats = (statsHolder.__vitalsModStats ??= { calls: 0, failures: 0, lastOk: true });

function recordCall(ok: boolean, status?: number): void {
  stats.calls++;
  stats.lastOk = ok;
  if (!ok) {
    stats.failures++;
    stats.lastFailureAt = Date.now();
    stats.lastStatus = status;
  }
}

export interface ModerationHealth {
  /** A key is set. Says nothing about whether calls succeed. */
  configured: boolean;
  calls: number;
  failures: number;
  /** A key is set but the most recent call did not get through. */
  degraded: boolean;
  lastFailureAt?: number;
  lastStatus?: number;
}

export function moderationHealth(): ModerationHealth {
  const configured = moderationConfigured();
  return {
    configured,
    calls: stats.calls,
    failures: stats.failures,
    // Keyed on the LAST call rather than any failure ever: one blip in an
    // hour-old process isn't an outage, and a currently-failing endpoint is.
    degraded: configured && stats.calls > 0 && !stats.lastOk,
    ...(stats.lastFailureAt ? { lastFailureAt: stats.lastFailureAt } : {}),
    ...(stats.lastStatus ? { lastStatus: stats.lastStatus } : {}),
  };
}

/** Test-only: forget recorded call outcomes. */
export function __resetModerationStats(): void {
  stats.calls = 0;
  stats.failures = 0;
  stats.lastOk = true;
  delete stats.lastFailureAt;
  delete stats.lastStatus;
}

/** Human-readable reason for a blocked create, e.g. "violence, hate". */
export function flaggedReason(result: ModerationResult): string {
  return result.categories.join(", ");
}

/**
 * Shared call to the moderation endpoint. `input` is either a plain string
 * (text-only) or an array of multimodal items. Never throws: on any failure it
 * returns an allowed, unchecked result (fail-open) so a hiccup can't take a
 * create path down.
 */
async function callModeration(input: string | InputItem[]): Promise<ModerationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input }),
      signal: controller.signal,
    });
    if (!res.ok) {
      recordCall(false, res.status); // fail open on a bad response
      return SKIPPED;
    }
    const data = (await res.json()) as {
      results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
    };
    const result = data.results?.[0];
    if (!result) {
      recordCall(false, res.status);
      return SKIPPED;
    }
    recordCall(true);
    const flagged = Boolean(result.flagged);
    const categories = flagged
      ? Object.entries(result.categories ?? {})
          .filter(([, tripped]) => tripped)
          .map(([name]) => name)
      : [];
    return { allowed: !flagged, flagged, categories, checked: true };
  } catch {
    recordCall(false); // no response at all — network error / timeout / abort
    return SKIPPED; // fail open
  } finally {
    clearTimeout(timer);
  }
}

/** Moderate a block of text. No-ops (allowed) without a key or on empty input. */
export async function moderateText(text: string): Promise<ModerationResult> {
  if (!moderationConfigured()) return SKIPPED;
  const input = text.slice(0, MAX_INPUT_CHARS).trim();
  if (!input) return CLEAN;
  return callModeration(input);
}

/**
 * Moderate a raw image. Sends the bytes as a base64 data URL to the multimodal
 * moderation model. No-ops (allowed) without a key or when the image is larger
 * than MAX_IMAGE_BYTES.
 */
export async function moderateImage(bytes: Uint8Array, contentType: string): Promise<ModerationResult> {
  if (!moderationConfigured()) return SKIPPED;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return SKIPPED;
  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  return callModeration([{ type: "image_url", image_url: { url: dataUrl } }]);
}
