# Personio MCP Server

## Project Overview
MCP server exposing the Personio HR API as callable tools for Claude/AI assistants. TypeScript, ESM, compiled to `./build`.

**Status**: ✅ v1.0.0 - Production Ready & NPM Package Prepared
**Repository**: https://github.com/NikolaiGoMedicus/personio-mcp-server
**NPM Package**: `@gomedicus/personio-mcp-server` (ready to publish)

## Quick Commands
```bash
# Development
npm run build          # Compile TypeScript → build/
npm run test:unit      # Offline unit tests (no credentials needed)
npm run test:e2e       # Live core suites: smoke + auth + application documents (needs .env credentials)
npm run test:other     # Live niche suites: location export, shoe size (needs .env credentials)
npm start              # Run compiled server
npm run inspector      # Run with MCP inspector

# Package Management
npm run setup          # Interactive setup wizard for Claude Desktop
npm publish            # Publish to npm registry (requires auth)

# User Installation (after publishing)
npm install -g @gomedicus/personio-mcp-server
personio-mcp-setup     # Automated setup wizard
```

## Architecture

### File Structure
```
src/
├── index.ts                          # MCP server, tool routing (switch/case)
├── api/personio-client.ts            # Centralized HTTP client (axios), v1+v2 API
├── auth/personio-auth.ts             # OAuth token management, auto-refresh
├── handlers/
│   ├── index.ts                      # Re-exports all handler classes
│   ├── employee-handlers.ts          # get, list, search
│   ├── attendance-handlers.ts        # v1: records, status, report
│   ├── attendance-handlers-v2.ts     # v2: CRUD + compatibility report
│   ├── absence-handlers.ts           # list, balance, types, overview, stats
│   ├── analytics-handlers.ts         # team availability (attendance + absence)
│   ├── document-handlers.ts          # categories, employee docs, upload/download
│   ├── approval-handlers.ts          # pending, attendance/absence status, summary
│   ├── recruiting-handlers.ts        # v2 recruiting API (apps, candidates, jobs)
│   └── utility-handlers.ts           # health check
├── tools/tool-definitions.ts         # All 40+ tool schemas (JSON Schema)
├── validators/index.ts               # Input validation functions
└── utils/export-helpers.ts           # CSV export
test-smoke.mjs                        # Smoke test suite (no framework)
```

### Patterns
- **Handler classes** take `PersonioClient` in constructor, expose `handle*` methods
- **All handlers** return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }` (MCP protocol)
- **Error responses** set `isError: true` on the result object
- **Recruiting handlers** catch 403 errors gracefully (scope may be missing)
- **V2 Attendance handlers** catch 403 and suggest v1 fallback
- **ID cascading** in tests: list calls provide IDs for get calls

### API Versions
- **v1**: `/v1/company/employees`, `/v1/company/attendances`, `/v1/company/time-offs`, etc.
- **v2**: `/v2/attendance-periods`, `/v2/recruiting/*`, `/v2/document-management/*`
- v2 recruiting uses Beta header; v2 auth is OAuth2 Client Credentials at `/v2/auth/token`

## Testing

### Smoke Tests (`test-smoke.mjs`)
- **32 tests**, 10 groups, ~15-20s runtime
- READ-ONLY: no create/update/delete
- Runs against live Personio API. Credentials are resolved by `test-credentials.mjs`:
  `PERSONIO_CLIENT_ID`/`PERSONIO_CLIENT_SECRET` env vars, a `.env` or `.env.<name>`
  in the repo root, or `~/.secrets/personio/.env.<name>`. The `<name>` comes from a
  test's first CLI arg, else `PERSONIO_CREDS_NAME`, else `recruiting` (use the env
  var for the chained `test:e2e`/`test:other` scripts)
- Tolerates missing scope (403/`forbidden`) and 404 (route unavailable) — counted
  as skipped/pass, never a failure, so the suite stays green with partial-scope
  credentials. Each group header notes the access right(s) it requires.
- Tests cover all read endpoints including recruiting filter regression tests

### Known API Behaviors
- **Employee documents endpoint** (`/v1/company/employees/{id}/documents`) returns 404 for some employees — the route may not be available for all plans/employees
- **Recruiting `updated_at` filters** (`updated_at_after`/`updated_at_before`) may return API errors depending on API version/plan — the test tolerates this
- **V2 Attendance** may return 403 if API credentials lack the v2 attendance scope — test skips gracefully
- **Recruiting endpoints** may return 403 if credentials lack `personio:recruiting:read` scope

## Findings & Bug History

### Recruiting Filter Bug (fixed)
Recruiting filter parameters were using wrong API parameter names, causing filters to be silently ignored. The smoke test group "Recruiting Filters (Regression)" specifically guards against this regression with `candidate_email` and `updated_at_after`/`updated_at_before` filter tests.

### Error Handling Inconsistency
- Most handlers throw `McpError` on failure (caught by the server's outer try/catch)
- Recruiting handlers return `{ isError: true }` result objects instead of throwing (graceful degradation)
- V2 Attendance handlers mix both: catch 403 → return error result, other errors → throw `McpError`
- Document handlers throw on all errors (no try/catch for 404s)

---

## NPM Package Distribution

### Current Status (v1.0.0 - 2026-03-05)

**✅ Completed:**
1. Package configuration updated (`@gomedicus/personio-mcp-server`)
2. `.npmignore` created (ships only `build/`, `scripts/`, `CLAUDE.md`)
3. Interactive setup wizard (`scripts/setup.mjs`)
   - Prompts for Personio credentials
   - Auto-detects Claude Desktop config path (macOS/Windows/Linux)
   - Automatically configures MCP server
4. Post-install script (`scripts/postinstall.js`)
   - Shows setup instructions after installation
5. README updated with NPM installation docs

**🔄 Pending:**
1. **Publishing Decision**: GitHub Packages vs NPM Registry
   - **GitHub Packages**: Free for private org packages, access control via GitHub
   - **NPM Registry**: Standard workflow, $7/month for private packages
2. **GitHub Actions**: Automated publishing on release tags
3. **First publish**: `npm publish` (requires npm login + org access)

### Installation Flow (After Publishing)

**For GoMedicus Team Members:**
```bash
# 1. Install globally
npm install -g @gomedicus/personio-mcp-server

# 2. Run setup wizard
personio-mcp-setup
# → Prompts for Personio Client ID & Secret
# → Automatically updates Claude Desktop config
# → Verifies installation

# 3. Restart Claude Desktop
# Done! All 41 Personio tools available in Claude
```

### Package Contents
- `build/` - Compiled TypeScript (ESM)
- `scripts/setup.mjs` - Interactive setup wizard
- `scripts/postinstall.js` - Post-install messaging
- `CLAUDE.md` - This documentation
- `README.md` - User-facing documentation

### Next Steps
1. Decide: GitHub Packages or NPM Registry?
2. Setup npm authentication (`npm login`)
3. First publish: `npm publish --access public` (or `--access restricted` for private)
4. Document internal distribution in GoMedicus Notion
5. (Optional) Setup GitHub Actions for automated releases
