// Helpers for turning a Personio 403 into an actionable error message that names
// the exact credential access right ("Zugriffsrechte") the caller must enable.
//
// Background: a Personio API credential's scopes are derived from per-area
// Read/Write toggles under Settings > Integrations > API Credentials. A tool can
// fail with 403 not because the *credential* is broken, but because the endpoint
// it calls belongs to an access area the credential was never granted — and that
// area is not always the one the tool's name implies (e.g. the recruiting
// document tools actually call the Document Management API, so they need
// "Documents" access, not "Recruiting"). These helpers keep the hint accurate and
// consistent across handlers.

// The credential access areas, with the English and German labels Personio shows
// in the access-rights UI, so the hint matches what the user actually sees.
export const ACCESS_AREAS = {
  employees:     { en: 'Employees',     de: 'Mitarbeitenden' },
  attendances:   { en: 'Attendances',   de: 'Anwesenheiten' },
  absences:      { en: 'Absences',      de: 'Abwesenheit' },
  documents:     { en: 'Documents',     de: 'Dokumenten' },
  recruiting:    { en: 'Recruiting',    de: 'Recruiting' },
  compensations: { en: 'Compensations', de: 'Vergütungen' },
} as const;

export type AccessArea = keyof typeof ACCESS_AREAS;

// True if `error` represents an HTTP 403. Robust to both error shapes that reach
// handlers: raw axios errors (with `.response.status`, from endpoints that use a
// fresh axios instance) and the wrapped `Error` the client's response
// interceptor throws (whose message contains the status text).
export function isForbiddenError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'response' in error) {
    if ((error as { response?: { status?: number } }).response?.status === 403) {
      return true;
    }
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('403') || message.includes('access denied') || message.includes('forbidden');
}

// Build a hint naming the access area(s) the failing tool needs. A single area is
// unambiguous; multiple areas tell the user a 403 means at least one is missing
// (used by composite tools that read across areas, e.g. attendance + employees).
export function accessRightHint(areas: AccessArea[], access: 'read' | 'write' = 'read'): string {
  const verb = access === 'write' ? 'Write (Bearbeiten)' : 'Read (Lesen)';
  const where = "your Personio API credential's Access rights (Zugriffsrechte) under " +
    'Settings > Integrations > API Credentials';
  const labels = areas.map(a => `"${ACCESS_AREAS[a].en}" (${ACCESS_AREAS[a].de})`);

  if (labels.length === 1) {
    return `This tool requires ${labels[0]} ${access} access. Enable ${labels[0]} -> ${verb} in ${where}.`;
  }
  return `This tool reads from multiple Personio areas: ${labels.join(', ')}. A 403 means at least ` +
    `one of them is not enabled. Enable the missing area(s) -> ${verb} in ${where}.`;
}

// Standard MCP error result (isError) for a 403, carrying the access-rights hint.
// Mirrors the existing recruiting/document handler error shape.
export function accessDeniedResult(
  operation: string,
  error: unknown,
  areas: AccessArea[],
  access: 'read' | 'write' = 'read'
) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: `Failed to ${operation}`,
          message,
          hint: accessRightHint(areas, access),
        }, null, 2),
      },
    ],
    isError: true,
  };
}
