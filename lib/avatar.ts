/**
 * Avatar helpers shared by the profile badge, the profile form, and anywhere
 * else a person is shown. Pure, so it runs on the client and the server.
 */

/** Up to two initials from a display name, for the no-photo fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
