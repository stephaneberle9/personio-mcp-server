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

### Notes
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
