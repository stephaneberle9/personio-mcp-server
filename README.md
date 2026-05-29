# personio-mcp-server

A Model Context Protocol (MCP) server for integrating with the Personio HR API. This server provides tools for accessing employee data, attendance records, absence information, and analytics through Claude or other AI assistants that support the MCP protocol.

## Features

- **Employee Management**: Get employee details, list all employees, search for employees, filter by office/location
- **Data Export**: Export employee lists in JSON or CSV format for easy spreadsheet integration
- **Attendance Tracking**: Retrieve attendance records, check current attendance status
- **Absence Management**: View absences, check absence balances, get absence types
- **Analytics**: Generate attendance reports, check team availability, analyze absence statistics
- **Utilities**: API health check

## Prerequisites

- Node.js 18 or higher
- Personio API credentials (Client ID and Client Secret)

## Installation

### Quick Install (Recommended for GoMedicus Team)

Install the package globally via npm:

```bash
npm install -g @gomedicus/personio-mcp-server
```

Then run the setup wizard:

```bash
personio-mcp-setup
```

The setup wizard will:
- Ask for your Personio API credentials
- Automatically configure Claude Desktop
- Verify the installation

**That's it!** Restart Claude Desktop and the Personio tools will be available.

---

### Manual Installation (Development)

For development or manual setup:

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Configuration

### Environment Variables

Set the following environment variables:

- `PERSONIO_CLIENT_ID`: Your Personio API client ID
- `PERSONIO_CLIENT_SECRET`: Your Personio API client secret
- `PERSONIO_DYNAMIC_FIELD_MAP` *(optional)*: JSON object overriding the readable
  name for specific Personio `dynamic_<id>` custom-field keys, e.g.
  `{"dynamic_14285869":"shoe_size"}`. Usually unnecessary — unmapped fields are
  named automatically from their Personio label. See
  [Retrieving additional attributes](#retrieving-additional-attributes).
- `PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS` *(optional)*: how long the attribute
  schema (used by `list_employee_attributes` and for translating attribute
  names) is cached before being refetched. Defaults to `3600` (1 hour). Lower it
  for a long-running deployment that must pick up renamed labels or new custom
  fields sooner; `0` disables caching entirely.

You can set these in a `.env` file in the project root:

```
PERSONIO_CLIENT_ID=your_client_id
PERSONIO_CLIENT_SECRET=your_client_secret
```

### MCP Client Configuration (Claude Desktop)

To use this server with Claude Desktop, add it to your Claude configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "personio": {
      "command": "node",
      "args": [
        "/absolute/path/to/personio-server/build/index.js"
      ],
      "env": {
        "PERSONIO_CLIENT_ID": "your_client_id",
        "PERSONIO_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

**Important:** Replace `/absolute/path/to/personio-server` with the actual path to this project directory.

After adding the configuration:
1. Restart Claude Desktop
2. The Personio tools will be available in your conversations
3. You can now ask Claude to export employee lists with locations!

## Usage

### Running the Server

```bash
npm start
```

Or with environment variables:

```bash
PERSONIO_CLIENT_ID=your_client_id PERSONIO_CLIENT_SECRET=your_client_secret npm start
```

### Using with Claude

Once configured, you can ask Claude to use the Personio tools. Here are some example requests:

**Export employees with locations:**
```
"Please export all employees from the Hamburg office as CSV"
"Give me a list of all employees with their office locations"
"Export the first 50 employees to CSV format"
```

**Filter by location:**
```
"How many employees work in the Berlin office?"
"Show me all employees in the Rangendingen location"
"List employees from remote offices"
```

**Get employee information:**
```
"Get details for employee ID 12345"
"Search for employees named John"
"Show me all employees in the IT department"
```

Claude will use the appropriate Personio MCP tools to fulfill your requests and can export the data in either JSON or CSV format as needed.

## Available Tools

### Pagination

List tools use one of two pagination styles, and both honor their advertised
contract. The guiding rule for style A is that pagination is applied **exactly
once** per request — never both server-side and client-side.

- **Offset/limit (style A)** — `limit`/`offset` parameters (Personio **v1**, plus
  the v2 attendance-periods endpoint). Personio honors `offset`/`limit`
  server-side on these endpoints, so:
  - **Unfiltered requests** forward `offset`/`limit` to Personio and rely on its
    server-side page. The client only *defensively clamps* the page down to
    `limit` (in case an endpoint ever returns more) and **never re-applies
    `offset`** — re-applying it would double the offset.
  - **Filtered requests** (e.g. an `office` filter) fetch the **complete**
    matching set, filter it client-side, then apply `offset`/`limit` **once** to
    the filtered result.
  - Responses include `count` (items returned this page), `total` (matching count
    before slicing — Personio `metadata.total_elements` for unfiltered requests,
    else the filtered count), and the effective `offset`/`limit`.
- **Cursor (style B)** — `cursor`/`limit` parameters (Personio **v2**). The
  server honors these and returns `next_cursor`; pass it back to fetch the next
  page. These tools are **not** sliced client-side.
- **`search_employees`** is a filtered case: its `limit` caps the number of
  *returned results* (default 50), **not** the number of employees scanned. The
  query is always evaluated against the **full** employee set (fetched via
  `getAllEmployees`), then the matches are sliced once; `total` reports the full
  match count.

Per-endpoint audit (all style-A offset/limit endpoints are honored server-side
and paginated exactly once):

| Tool | Style | Honored server-side? | Enforcement |
| --- | --- | --- | --- |
| `list_employees` | offset/limit (v1) | Yes | server page (unfiltered) / slice once after filter (office) |
| `search_employees` | results cap (v1) | n/a — full scan | full scan, then slice results once |
| `get_attendance_records` | offset/limit (v1) | Yes | server page, defensive `limit` clamp |
| `get_absences` | offset/limit (v1) | Yes | server page, defensive `limit` clamp |
| `get_pending_approvals` | offset/limit (v1) | Yes | server page, defensive `limit` clamp |
| `get_attendance_approval_status` | offset/limit (v1) | Yes | server page, defensive `limit` clamp |
| `get_absence_approval_status` | offset/limit (v1) | Yes | server page, defensive `limit` clamp |
| `get_attendance_periods_v2` | offset/limit (v2) | Yes | server page, defensive `limit` clamp |
| `get_documents_by_category` | `employee_limit` (v1) | n/a | client-side cap (no `offset`) |
| `generate_v1_v2_compatibility_report` | `limit` | n/a | client-side `limit` cap (no `offset`) |
| `get_employee_documents` | cursor (v2) | Yes | passthrough (`_meta`) |
| `list_recruiting_applications` | cursor (v2) | Yes | passthrough (`next_cursor`) |
| `list_recruiting_candidates` | cursor (v2) | Yes | passthrough (`next_cursor`) |
| `list_recruiting_jobs` | cursor (v2) | Yes | passthrough (`next_cursor`) |
| `list_application_documents` | cursor (v2) | Yes | passthrough (`next_cursor`) |

### Employee Tools

- `get_employee`: Get detailed information about a specific employee by ID
  - Returns the friendly core fields (id, name, email, position, department,
    **office/location**, status, hire_date, weekly_hours) **plus every other
    attribute the API credential's scope permits**. See
    [Retrieving additional attributes](#retrieving-additional-attributes).

- `list_employees`: Get a list of all employees with optional filtering and export formats
  - **Parameters:**
    - `limit`: Maximum number of employees to return (default: 200)
    - `offset`: Number of employees to skip for pagination
    - `attributes`: Specific employee attributes to retrieve
    - `office`: Filter employees by office/workplace name (case-insensitive partial match)
    - `format`: Output format - `"json"` (default) or `"csv"` for spreadsheet export
  - **Features:**
    - Filter by office/location to find employees in specific workplaces
    - Export to CSV format for easy spreadsheet import
    - Includes office/location field in all employee records

- `search_employees`: Search for employees by name, email, or department

**Example Usage:**
```javascript
// Get all employees in Hamburg office
list_employees({ office: "Hamburg" })

// Export first 100 employees as CSV
list_employees({ limit: 100, format: "csv" })

// Get employees from a specific office as CSV
list_employees({ office: "Berlin", format: "csv" })
```

### Retrieving additional attributes

Beyond the friendly core fields, `get_employee` and `list_employees` return
**any attribute the Personio API credential's scope permits**. There is no
hardcoded whitelist — the set of fields you get back depends entirely on the
credential's *readable attributes* configuration in Personio.

**Requesting specific fields.** Use the `attributes` parameter to list the
fields you want. You can mix **raw Personio keys** and **resolved output names**
(see *Naming dynamic custom fields* below) — the server translates names back to
the raw keys the API expects:

```javascript
// raw keys, resolved output names, and friendly aliases all work:
get_employee({ employee_id: 12345, attributes: ["name", "email", "shoe_size", "kostenstelle_kurz"] })
list_employees({ attributes: ["first_name", "last_name", "department"] })
```

> [!IMPORTANT]
> Personio's filtering is **restrictive**: passing `attributes` limits the
> response to *exactly* those keys. Include **every** field you need (the core
> fields too, e.g. `first_name`/`last_name` — or just the derived `name`, which
> expands to both) — anything omitted will not be returned. Omit `attributes`
> entirely to get every attribute the scope allows.

**Naming dynamic custom fields.** Personio exposes custom fields under opaque
`dynamic_<id>` keys. The server resolves each one to a readable output key using
the following precedence:

1. **Explicit mapping** — an entry in `PERSONIO_DYNAMIC_FIELD_MAP` (or the
   built-in `DYNAMIC_FIELD_MAP` default `dynamic_14285869` → `shoe_size`) always
   wins.
2. **Automatic label** — otherwise the field's own Personio label is slugified,
   e.g. `"Kostenstelle kurz"` → `kostenstelle_kurz`, `"Mobil (itemis)"` →
   `mobil_itemis`. German umlauts are transliterated (ä→ae, ö→oe, ü→ue, ß→ss).
3. **Raw key** — if there is no label, the field keeps its `dynamic_<id>` key.

This means **you usually don't need to configure anything** — labels are used
automatically. Set `PERSONIO_DYNAMIC_FIELD_MAP` only to *override* the cases
where a label is missing or a poor fit:

```bash
PERSONIO_DYNAMIC_FIELD_MAP='{"dynamic_14285869":"shoe_size","dynamic_98765432":"cost_center"}'
```

If two labels would slugify to the same key (or a derived key would clash with a
built-in field like `status`), the first field keeps the readable name and the
colliding one falls back to its raw `dynamic_<id>` key, so no value is ever
silently dropped. Non-dynamic attributes always pass through under their
original key.

**Discovering a tenant's attribute keys.** Different Personio tenants expose
different keys and `dynamic_<id>` values. There are two ways to find out what is
available:

- **At runtime (for the AI/agent)** — the `list_employee_attributes` tool returns,
  for every attribute the scope exposes, its raw `key`, the `output_key` it is
  surfaced under, the `source` of that name (`map` | `label` | `key`), its
  `label` and value `type`. Either `key` or `output_key` can then be passed to
  `attributes`. The `attributes` parameter descriptions point here, so the agent
  can discover fields on its own.
- **As an MCP resource (for the client/user)** — the same catalog is exposed at
  the resource URI `personio://employees/attributes`, so clients that support
  resources can attach it to the model's context proactively (no tool call
  needed). The tool and the resource serve the same data from one cached source.
- **From the shell (for developers)** — the `print-attributes` helper prints the
  same schema as a table:

  ```bash
  npm run build
  npm run attributes -- <employeeId>
  ```

Use either to decide which fields to request via `attributes`, and to spot any
`dynamic_<id>` fields whose auto-derived label name you want to override in
`PERSONIO_DYNAMIC_FIELD_MAP`.

The schema is cached and refetched periodically (see
`PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS`), so renamed labels and newly added custom
fields are picked up automatically by a long-running server.

> [!NOTE]
> **Example — compensation fields.** Salary is just one example of this generic
> behavior: to retrieve a salary field, add its attribute key to `attributes`;
> if it is a custom field, map its `dynamic_<id>` in `PERSONIO_DYNAMIC_FIELD_MAP`
> to give it a readable name. Be aware that Personio salary attributes are a
> current master-data **snapshot per employee** — they are not actual monthly
> payroll cost (no employer contributions, variable pay, or mid-month
> joiners/leavers).

### Attendance Tools (V1 API)

- `get_attendance_records`: Retrieve attendance records with optional date and employee filters
- `get_current_attendance_status`: Get current attendance status for today
- `generate_attendance_report`: Generate attendance analytics report for a date range

### Attendance Tools (V2 API) - Enhanced Features

- `get_attendance_periods_v2`: List attendance periods with timezone support and enhanced filtering
- `get_attendance_period_v2`: Get a specific attendance period by ID
- `create_attendance_period_v2`: Create attendance periods with timezone support and period types
- `update_attendance_period_v2`: Update existing attendance periods
- `delete_attendance_period_v2`: Delete attendance periods
- `generate_v1_v2_compatibility_report`: Compare v1 and v2 API responses for migration planning

**V2 API Features:**
- Timezone support (start/end times with timezone information)
- Support for different period types (AttendancePeriod, Break)
- ISO 8601 datetime format support
- Enhanced error handling with scope-specific messages
- Backward compatibility helpers for v1/v2 data conversion

### Absence Tools

- `get_absences`: Retrieve absence/time-off records with optional filters
- `get_employee_absence_balance`: Get absence balance for a specific employee
- `get_absence_types`: Get all available absence/time-off types
- `get_team_absence_overview`: Get overview of who is out today or in a specific date range
- `get_absence_statistics`: Get absence usage statistics and trends

### Utility Tools

- `api_health_check`: Check Personio API connectivity and authentication status

## Development

### Project Structure

- `src/api/`: API client for Personio
- `src/auth/`: Authentication logic
- `src/handlers/`: Tool handlers organized by category
- `src/validators/`: Input validation helpers
- `src/tools/`: Tool definitions
- `src/index.ts`: Main server file

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Testing Location Export Features

Run the location export test script to verify the new features:

```bash
node test-location-export.mjs
```

This will test:
- Employee office/location field retrieval
- Filtering employees by office
- CSV export format
- Combined office filtering with CSV export

## CSV Export Format

When using `format: "csv"` with the `list_employees` tool, the output includes:

- Header row with column names
- Employee data with fields: ID, Name, Email, Position, Department, Office, Status, Hire Date, Weekly Hours
- Proper CSV escaping for special characters (commas, quotes, newlines)
- Metadata including export timestamp and total employee count
- **Note**: Additional fields like shoe_size are only available in JSON format, not CSV exports

The CSV format is ideal for:
- Importing into Excel or Google Sheets
- Further data analysis
- Creating reports
- Backup purposes

## License

MIT

## Author

Nikolai Bockholt
