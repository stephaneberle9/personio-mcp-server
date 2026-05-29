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
- `PERSONIO_DYNAMIC_FIELD_MAP` *(optional)*: JSON object mapping Personio
  `dynamic_<id>` custom-field keys to readable names, e.g.
  `{"dynamic_14285869":"shoe_size"}`. Merged on top of the built-in defaults.
  See [Retrieving additional attributes](#retrieving-additional-attributes).

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
attribute keys you want:

```javascript
get_employee({ employee_id: 12345, attributes: ["first_name", "last_name", "email", "dynamic_14285869"] })
list_employees({ attributes: ["first_name", "last_name", "department"] })
```

> [!IMPORTANT]
> Personio's filtering is **restrictive**: passing `attributes` limits the
> response to *exactly* those keys. Include **every** field you need (the core
> fields too, e.g. `first_name`/`last_name` for the derived `name`) — anything
> omitted will not be returned. Omit `attributes` entirely to get every
> attribute the scope allows.

**Naming dynamic custom fields.** Personio exposes custom fields under opaque
`dynamic_<id>` keys. The server renames known ones to readable names via a
central `DYNAMIC_FIELD_MAP` (default: `dynamic_14285869` → `shoe_size`). To name
any other custom field without a code change, set the
`PERSONIO_DYNAMIC_FIELD_MAP` environment variable to a JSON object; its entries
are merged on top of the defaults:

```bash
PERSONIO_DYNAMIC_FIELD_MAP='{"dynamic_14285869":"shoe_size","dynamic_98765432":"cost_center"}'
```

Attributes not present in the map pass through under their original key.

**Discovering a tenant's attribute keys.** Different Personio tenants expose
different keys and `dynamic_<id>` values. To list everything a given employee
exposes (key, label, value type, and any mapped name):

```bash
npm run build
npm run attributes -- <employeeId>
```

Use that output to decide which keys to request via `attributes` and which
`dynamic_<id>` fields to name in `PERSONIO_DYNAMIC_FIELD_MAP`.

> [!NOTE]
> **Example — compensation fields.** Salary is just one example of this generic
> behaviour: to retrieve a salary field, add its attribute key to `attributes`;
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
