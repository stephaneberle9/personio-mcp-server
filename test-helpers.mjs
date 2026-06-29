/**
 * Shared helpers for the live test scripts (smoke, auth, ...).
 */

/** True if this text looks like a Personio 403 / forbidden / missing-scope error. */
export function looksForbidden(text) {
  const t = (text || '').toLowerCase();
  // Covers "...status code 403", "access denied", and the v1 wording
  // "personio.core.api.exceptions.api.forbidden.http.exception".
  return t.includes('403') || t.includes('access denied') || t.includes('forbidden');
}
