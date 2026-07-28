/**
 * AI content moderation via OpenAI's free moderation endpoint.
 *
 * Study material that users author is run through `omni-moderation-latest`
 * before it is stored, so obviously harmful content is refused up front. The
 * model is multimodal, so both TEXT (deck cards, quiz questions, titles) and
 * IMAGES (card/question pictures, image uploads) can be checked. The endpoint
 * is free to call.
 *
 * Posture:
 *   - No OPENAI_API_KEY  -> moderation is SKIPPED (checked: false, allowed).
 *     The feature is opt-in via env, so a local/demo deploy stays keyless.
 *   - API error / timeout -> FAIL OPEN (allowed). A moderation outage must not
 *     block every upload; the audit log still records the create.
 *   - Content flagged     -> BLOCKED, with the tripped category names.
 */

const ENDPOINT = "https://api.openai.com/v1/moderations";
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
    if (!res.ok) return SKIPPED; // fail open on a bad response
    const data = (await res.json()) as {
      results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
    };
    const result = data.results?.[0];
    if (!result) return SKIPPED;
    const flagged = Boolean(result.flagged);
    const categories = flagged
      ? Object.entries(result.categories ?? {})
          .filter(([, tripped]) => tripped)
          .map(([name]) => name)
      : [];
    return { allowed: !flagged, flagged, categories, checked: true };
  } catch {
    return SKIPPED; // fail open on network error / timeout / abort
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
