# Changelog

All notable changes to the personio-mcp-server project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `get_employee` and `list_employees` now return **any attribute the Personio
  API credential's scope permits**, instead of a fixed whitelist. Callers
  retrieve additional fields by listing them in the `attributes` parameter.
  Note Personio's restrictive filtering: passing `attributes` limits the
  response to exactly those keys, so include every field you need.
- Automatic readable names for `dynamic_<id>` custom fields: when a field is not
  explicitly mapped, its Personio label is slugified into the output key (e.g.
  `"Kostenstelle kurz"` → `kostenstelle_kurz`; German umlauts transliterated).
  Colliding derived keys fall back to the raw `dynamic_<id>` key so no value is
  silently dropped. `slugifyLabel`/`resolveAttributeKey` are exported for reuse.
- `DYNAMIC_FIELD_MAP` for renaming Personio `dynamic_<id>` custom fields to
  readable names, overridable/extensible at runtime via the
  `PERSONIO_DYNAMIC_FIELD_MAP` environment variable (JSON), merged over the
  built-in defaults. Given the automatic label naming above, it is only needed
  to *override* labels that are missing or a poor fit — no code change required.
- `list_employee_attributes` tool: discovers, at runtime, every attribute the
  scope exposes — its raw `key`, the `output_key` it is surfaced under, that
  name's `source` (`map` | `label` | `key`), `label` and value `type`. Lets the
  AI/agent learn which field names to request without a code change.
- MCP **resource** `personio://employees/attributes` exposing the same attribute
  catalog, so clients can attach it to context proactively (complements the
  tool, which the model calls on demand). Adds the `resources` server capability.
- The `attributes` parameter of `get_employee` / `list_employees` now accepts
  **either raw Personio keys or resolved output names** (e.g. `name`,
  `weekly_hours`, `shoe_size`, `kostenstelle_kurz`); names are translated back to
  the raw keys the API expects, with unknown names passed through unchanged.
- The tenant attribute schema (used for discovery and name translation) is cached
  with a configurable TTL via `PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS` (default 1
  hour; `0` disables caching) and refetched afterwards, so a long-running server
  (e.g. a web connector) picks up renamed labels and new custom fields.
- `print-attributes.mjs` helper (`npm run attributes -- <employeeId>`) that
  prints the same attribute schema (key, output key + source, label, value type)
  as a table — the developer-facing counterpart to `list_employee_attributes`.
- Offline unit tests for `formatEmployeeData` and the attribute-schema helpers
  (`npm run test:unit`).

### Changed
- `formatEmployeeData` preserves falsy attribute values (`0`, `false`, `""`)
  instead of dropping them, and is now typed via a `FormattedEmployee`
  interface (known fields plus an index signature) instead of `any`.

### Fixed
- **List tools now apply offset/limit pagination exactly once.** The "style A"
  offset/limit list tools advertise `limit`/`offset`, and Personio honors them
  server-side. A prior change both forwarded those parameters *and* re-sliced the
  result client-side by the same offset/limit, double-applying the offset — e.g.
  `list_employees` with `offset=5,limit=5` returned an empty page, and
  `offset=3,limit=5` returned the records at absolute indices 6–7 (offset applied
  as 3+3); `limit` alone only looked correct because re-slicing a `limit`-sized
  page by `[0:limit]` is a no-op. Pagination is now applied a single time, via a
  shared `paginateStyleA` helper (`src/utils/pagination.ts`) that centralizes the
  filtered-vs-unfiltered decision:
  - **Unfiltered requests** forward `offset`/`limit` to Personio and use its
    server-side page; the client only defensively clamps the page down to `limit`
    and never re-applies `offset`.
  - **Filtered requests** (e.g. `list_employees` with an `office` filter) fetch
    the complete matching set, filter it, then slice once.

  Affected tools: `list_employees`, `get_attendance_records`, `get_absences`,
  `get_pending_approvals`, `get_attendance_approval_status`,
  `get_absence_approval_status`, and `get_attendance_periods_v2` (v2
  offset/limit). `limit`/`offset` are still clamped to each tool's documented
  bounds.
- **`getAllEmployees` no longer terminates a filtered full-fetch early.** It now
  pages over the raw (unfiltered) set — so the short-page/total termination
  conditions see the API's true page sizes — and applies the `office` filter to
  the fully-collected result. Previously, filtering page-by-page could stop after
  the first page and miss matches beyond it.
- **`search_employees` scans the full employee set.** Its `limit` caps the number
  of *returned results* (default 50), not the number of employees scanned. It
  fetches every employee (`PersonioClient.getAllEmployees`, which pages
  defensively and de-duplicates), filters across the full set, then slices the
  matches once. The response reports `count` (results this page) and `total` (all
  matches before slicing).
- **`get_documents_by_category`** enforces its `employee_limit` (employees
  scanned) client-side; **`generate_v1_v2_compatibility_report`** enforces its
  `limit` on both record sets it compares. Both apply a `limit`-only cap (no
  `offset`), so neither was affected by the double-application.
- Style-A responses include consistent metadata: `count` (items returned this
  page), `total` (matching count before slicing — Personio
  `metadata.total_elements` for unfiltered requests, else the filtered count),
  and the effective `offset`/`limit`. CSV and JSON output for `list_employees`
  return the same sliced set.

### Notes
- **Cursor-based ("style B") tools are unchanged.** The v2 recruiting tools
  (`list_recruiting_applications`, `list_recruiting_candidates`,
  `list_recruiting_jobs`, `list_application_documents`) and
  `get_employee_documents` use cursor pagination, which Personio v2 honors
  server-side. They forward `cursor`/`limit` and surface `next_cursor` verbatim;
  they are deliberately **not** client-side sliced, so the cursor contract is
  never corrupted.
- Per-endpoint pagination audit (style, whether the parameter is honored
  server-side, and the action taken) is summarized in the README under
  *Pagination*.
- The returned fields depend entirely on the API credential's readable-attributes
  scope. Compensation is one example: to retrieve a salary field add its key to
  `attributes` (and map its `dynamic_<id>` if it is a custom field). Personio
  salary attributes are a current master-data snapshot per employee, not actual
  monthly payroll cost (no employer contributions, variable pay, or mid-month
  joiners/leavers).

## [0.1.0] - 2025-05-23

### Added
- Initial release of personio-mcp-server
- Employee management tools (get_employee, list_employees, search_employees)
- Attendance tracking tools (get_attendance_records, get_current_attendance_status, generate_attendance_report)
- Absence management tools (get_absences, get_employee_absence_balance, get_absence_types, get_team_absence_overview, get_absence_statistics)
- Analytics tools (get_team_availability)
- Document management tools (get_document_categories, get_employee_documents, upload_document, download_document, delete_document, get_documents_by_category)
- Approval workflow tools (create_attendance_with_approval, get_pending_approvals, get_attendance_approval_status, get_absence_approval_status, get_approval_workflow_summary)
- Utility tools (api_health_check)
