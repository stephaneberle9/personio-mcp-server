// Shared offset/limit pagination enforcement for "style A" list tools.
//
// The cardinal rule: apply offset/limit EXACTLY ONCE per request. A prior change
// both forwarded offset/limit to Personio AND re-sliced the result client-side
// by the same offset/limit. Since Personio *does* honor offset/limit server-side
// on these endpoints, that double-applied the offset — `list_employees` with
// `offset=5,limit=5` returned an empty page, and `offset=3,limit=5` returned the
// records at absolute indices 6–7 (offset applied as 3+3). `limit` alone only
// looked correct because re-slicing a `limit`-sized page by [0:limit] is a no-op.
//
// `paginateStyleA` centralizes the single-application rule by branching on
// whether the request used a client-side filter:
//
//   * UNFILTERED (mode 'server'): offset/limit were forwarded to Personio and
//     the page it returned is authoritative. We must NOT re-apply `offset`; we
//     only defensively clamp the page down to `limit` should the server ever
//     return more than requested. `total` comes from the server's reported total.
//
//   * FILTERED (mode 'client'): the handler fetched the COMPLETE matching set
//     (no server-side offset/limit) and filtered it client-side. We then slice
//     that filtered set exactly once with offset+limit. `total` is the filtered
//     match count (before slicing).
//
// This keeps the filtered-vs-unfiltered decision in one place so it cannot drift
// between the style-A endpoints. `applyOffsetLimit` remains the single-slice
// primitive (used directly for the `limit`-only caps in `get_documents_by_category`
// and `generate_v1_v2_compatibility_report`, where no `offset` is in play).

/** Caller-supplied pagination inputs (already JSON-validated as numbers/undefined). */
export interface OffsetLimitParams {
  offset?: number;
  limit?: number;
}

/** Documented bounds for a given tool's `limit`, mirroring its inputSchema. */
export interface OffsetLimitBounds {
  /** Applied when `limit` is omitted. */
  defaultLimit: number;
  /** Upper bound (inclusive); raw input above this is clamped down. */
  maxLimit: number;
  /** Lower bound (inclusive); defaults to 1. */
  minLimit?: number;
}

/** Result of slicing, including the effective values actually applied. */
export interface PaginatedSlice<T> {
  /** The sliced page of items (length never exceeds the effective limit). */
  items: T[];
  /** The offset actually applied (clamped to a non-negative integer). */
  offset: number;
  /** The limit actually applied (clamped to the documented bounds). */
  limit: number;
}

/**
 * Clamp a caller-supplied `limit` to the tool's documented bounds. A missing or
 * non-finite value falls back to `defaultLimit`; out-of-range values are clamped
 * into `[minLimit, maxLimit]`. Fractional input is floored.
 */
export function clampLimit(limit: number | undefined, bounds: OffsetLimitBounds): number {
  const min = bounds.minLimit ?? 1;
  if (limit === undefined || !Number.isFinite(limit)) return bounds.defaultLimit;
  const floored = Math.floor(limit);
  if (floored < min) return min;
  if (floored > bounds.maxLimit) return bounds.maxLimit;
  return floored;
}

/**
 * Clamp a caller-supplied `offset` to a non-negative integer. A missing or
 * non-finite/negative value becomes `0`. Fractional input is floored.
 */
export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

/**
 * Enforce a tool's advertised offset/limit contract on an already-fetched (and
 * already-filtered) list, independent of whether Personio applied it. Returns
 * the sliced page plus the effective `offset`/`limit` for response metadata.
 *
 * Validates/clamps against the documented bounds instead of trusting raw input,
 * so the returned length never exceeds the tool's maximum.
 */
export function applyOffsetLimit<T>(
  items: T[],
  params: OffsetLimitParams,
  bounds: OffsetLimitBounds
): PaginatedSlice<T> {
  const offset = clampOffset(params.offset);
  const limit = clampLimit(params.limit, bounds);
  return {
    items: items.slice(offset, offset + limit),
    offset,
    limit,
  };
}

/** A fully paginated style-A page plus the `total` for response metadata. */
export interface StyleAPage<T> {
  /** The items to return for this page. */
  items: T[];
  /** Effective offset (echoed; clamped to a non-negative integer). */
  offset: number;
  /** Effective limit (clamped to the documented bounds). */
  limit: number;
  /** Total matching count BEFORE slicing (full set / server total). */
  total: number;
}

/**
 * How a style-A request reached its data, which determines how (and whether)
 * offset/limit are applied here — see the module header.
 *
 * - `{ mode: 'server', total }`: UNFILTERED. `items` is the page Personio already
 *   returned for the forwarded offset/limit; offset is NOT re-applied (only a
 *   defensive `limit` truncation), and `total` is the server's reported total.
 * - `{ mode: 'client' }`: FILTERED. `items` is the COMPLETE matching set; it is
 *   sliced once by offset+limit, and `total` is its length before slicing.
 */
export type StyleASource =
  | { mode: 'server'; total: number }
  | { mode: 'client' };

/**
 * Apply a style-A tool's advertised offset/limit contract EXACTLY ONCE, choosing
 * server- vs client-side semantics from `source`. This is the single decision
 * point shared by every style-A endpoint, so the filtered-vs-unfiltered rule is
 * defined in one place and never double-applied (see the module header).
 */
export function paginateStyleA<T>(
  items: T[],
  params: OffsetLimitParams,
  bounds: OffsetLimitBounds,
  source: StyleASource
): StyleAPage<T> {
  const offset = clampOffset(params.offset);
  const limit = clampLimit(params.limit, bounds);

  if (source.mode === 'server') {
    // Personio already applied offset/limit. Re-applying `offset` here is the
    // double-application bug; only truncate if the server returned more than
    // `limit` (defensive, in case an endpoint ignores `limit`). `offset` is
    // echoed for metadata but never used to re-slice.
    return { items: items.slice(0, limit), offset, limit, total: source.total };
  }

  // Filtered: `items` is the full matching set — slice it exactly once.
  return {
    items: items.slice(offset, offset + limit),
    offset,
    limit,
    total: items.length,
  };
}
