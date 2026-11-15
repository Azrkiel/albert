/**
 * Next.js hands page route params to the server still percent-encoded (route handlers get them decoded).
 * Imported ids contain their own `%2F`-style escapes, so a page decodes the segment exactly once and
 * never decodes the result again.
 */
export function decodeRouteId(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}
