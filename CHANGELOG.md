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
- `DYNAMIC_FIELD_MAP` for renaming Personio `dynamic_<id>` custom fields to
  readable names, overridable/extensible at runtime via the
  `PERSONIO_DYNAMIC_FIELD_MAP` environment variable (JSON), merged over the
  built-in defaults — so tenant-specific field IDs can be named without a code
  change.
- `print-attributes.mjs` helper (`npm run attributes -- <employeeId>`) that
  lists every attribute key, label, value type, and mapped name a tenant
  exposes for an employee — the generic way to discover which keys/`dynamic_<id>`
  fields to request and name.
- Offline unit tests for `formatEmployeeData` (`npm run test:unit`).

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
