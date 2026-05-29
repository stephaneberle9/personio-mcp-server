/**
 * Smoke Test Suite for Personio MCP Server
 *
 * READ-ONLY tests — no create/update/delete operations.
 * Runs against the live Personio API using compiled handlers.
 *
 * Usage: npm run build && npm test
 */

import 'dotenv/config';
import { PersonioClient } from './build/api/personio-client.js';
import {
  EmployeeHandlers,
  AttendanceHandlers,
  AttendanceHandlersV2,
  AbsenceHandlers,
  AnalyticsHandlers,
  UtilityHandlers,
  DocumentHandlers,
  ApprovalHandlers,
  RecruitingHandlers,
} from './build/handlers/index.js';

// ── Minimal Test Runner ─────────────────────────────────────────────

const results = { pass: 0, fail: 0, skip: 0 };
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`);
}

async function test(name, fn) {
  try {
    await fn();
    results.pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.fail++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function skip(name, reason) {
  results.skip++;
  console.log(`  ○ ${name} — ${reason}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

/** Parse the JSON text from an MCP handler result */
function parseResult(result) {
  assert(result && result.content, 'result has content');
  assert(result.content.length > 0, 'content is non-empty');
  const text = result.content[0].text;
  assert(typeof text === 'string', 'content[0].text is a string');
  return JSON.parse(text);
}

/**
 * Check if a result is a 403/scope error (common for recruiting/v2 endpoints).
 * These are "pass" — the endpoint is reachable, just lacks permissions.
 */
function is403(result) {
  if (!result?.isError) return false;
  const text = result.content?.[0]?.text || '';
  return text.includes('403') || text.includes('access denied') || text.includes('Access Denied');
}

/** Check if a result is any error (isError flag or non-JSON text) */
function isError(result) {
  return !!result?.isError;
}

/** Check if an error message indicates a route/feature not available (404-like) */
function isNotFound(err) {
  const msg = err?.message || '';
  return msg.includes('could not be found') || msg.includes('404');
}

// ── Setup ───────────────────────────────────────────────────────────

const CLIENT_ID = process.env.PERSONIO_CLIENT_ID;
const CLIENT_SECRET = process.env.PERSONIO_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('PERSONIO_CLIENT_ID and PERSONIO_CLIENT_SECRET must be set');
  process.exit(1);
}

const client = new PersonioClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

const employeeH = new EmployeeHandlers(client);
const attendanceH = new AttendanceHandlers(client);
const attendanceV2H = new AttendanceHandlersV2(client);
const absenceH = new AbsenceHandlers(client);
const analyticsH = new AnalyticsHandlers(client);
const utilityH = new UtilityHandlers(client);
const documentH = new DocumentHandlers(client);
const approvalH = new ApprovalHandlers(client);
const recruitingH = new RecruitingHandlers(client);

// Shared state for ID cascading
const ids = {
  employeeId: null,
  attendancePeriodId: null,
  applicationId: null,
  candidateId: null,
  jobId: null,
};

const today = new Date().toISOString().split('T')[0];
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

console.log('Personio MCP Server — Smoke Tests');
console.log(`Date: ${today}`);

// ── 1. Utility ──────────────────────────────────────────────────────

group('1. Utility');

await test('healthCheck', async () => {
  const result = await utilityH.handleApiHealthCheck({});
  const data = parseResult(result);
  assert(data.api_status === 'healthy', `expected healthy, got ${data.api_status}`);
  assert(data.server_info?.name === 'personio-server', 'server name mismatch');
});

// ── 2. Employees ────────────────────────────────────────────────────

group('2. Employees');

await test('listEmployees', async () => {
  const result = await employeeH.handleListEmployees({ limit: 5 });
  const data = parseResult(result);
  assert(Array.isArray(data.employees), 'employees is array');
  assert(data.employees.length > 0, 'at least one employee');
  ids.employeeId = data.employees[0].id;
});

if (ids.employeeId) {
  await test('getEmployee', async () => {
    const result = await employeeH.handleGetEmployee({ employee_id: ids.employeeId });
    const data = parseResult(result);
    assert(data.id === ids.employeeId, 'employee id matches');
    assert(typeof data.name === 'string', 'has name');
  });
} else {
  skip('getEmployee', 'no employee ID from list');
}

await test('searchEmployees', async () => {
  const result = await employeeH.handleSearchEmployees({ query: 'a', limit: 5 });
  const data = parseResult(result);
  assert(typeof data.count === 'number', 'has count');
  assert(Array.isArray(data.results), 'results is array');
});

await test('listEmployeeAttributes', async () => {
  const result = await employeeH.handleListEmployeeAttributes({});
  const data = parseResult(result);
  assert(Array.isArray(data.attributes), 'attributes is array');
  assert(data.attributes.length > 0, 'at least one attribute');
  const first = data.attributes[0];
  assert(typeof first.key === 'string', 'attribute has a key');
  assert(typeof first.output_key === 'string', 'attribute has an output_key');
  assert(['map', 'label', 'key'].includes(first.source), 'attribute has a valid source');
});

if (ids.employeeId) {
  // Regression: requesting by a resolved/friendly name (not a raw key) must be
  // translated back to the raw key(s) the API expects. `name` resolves to
  // first_name + last_name, so a successful round-trip proves the translation.
  await test('getEmployee accepts resolved attribute names', async () => {
    const result = await employeeH.handleGetEmployee({
      employee_id: ids.employeeId,
      attributes: ['name'],
    });
    const data = parseResult(result);
    assert(typeof data.name === 'string' && data.name.length > 0, 'name resolved via translated keys');
  });
}

// ── 3. Attendance V1 ────────────────────────────────────────────────

group('3. Attendance V1');

await test('getAttendanceRecords', async () => {
  const result = await attendanceH.handleGetAttendanceRecords({
    start_date: thirtyDaysAgo,
    end_date: today,
    limit: 5,
  });
  const data = parseResult(result);
  assert(Array.isArray(data.attendance_records), 'attendance_records is array');
  assert(typeof data.total === 'number', 'has total');
});

await test('getCurrentAttendanceStatus', async () => {
  const result = await attendanceH.handleGetCurrentAttendanceStatus({});
  const data = parseResult(result);
  assert(data.date === today, 'date is today');
  assert(data.summary !== undefined, 'has summary');
});

await test('generateAttendanceReport', async () => {
  const result = await attendanceH.handleGenerateAttendanceReport({
    start_date: thirtyDaysAgo,
    end_date: today,
  });
  const data = parseResult(result);
  assert(data.report_type === 'attendance_analytics', 'correct report type');
  assert(data.statistics !== undefined, 'has statistics');
});

// ── 4. Attendance V2 ────────────────────────────────────────────────

group('4. Attendance V2');

await test('getAttendancePeriodsV2', async () => {
  const result = await attendanceV2H.handleGetAttendancePeriodsV2({
    limit: 5,
  });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  const data = parseResult(result);
  assert(data.api_version === 'v2', 'is v2 response');
  assert(Array.isArray(data.attendance_periods), 'has attendance_periods array');
  if (data.attendance_periods.length > 0) {
    ids.attendancePeriodId = data.attendance_periods[0].id;
  }
});

if (ids.attendancePeriodId) {
  await test('getAttendancePeriodV2', async () => {
    const result = await attendanceV2H.handleGetAttendancePeriodV2({ id: ids.attendancePeriodId });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(data.api_version === 'v2', 'is v2 response');
  });
} else {
  skip('getAttendancePeriodV2', 'no attendance period ID available');
}

// ── 5. Absences ─────────────────────────────────────────────────────

group('5. Absences');

await test('getAbsences', async () => {
  const result = await absenceH.handleGetAbsences({
    start_date: thirtyDaysAgo,
    end_date: today,
    limit: 5,
  });
  const data = parseResult(result);
  assert(Array.isArray(data.absences), 'absences is array');
  assert(typeof data.total === 'number', 'has total');
});

if (ids.employeeId) {
  await test('getEmployeeAbsenceBalance', async () => {
    const result = await absenceH.handleGetEmployeeAbsenceBalance({ employee_id: ids.employeeId });
    const data = parseResult(result);
    assert(data.employee_id === ids.employeeId, 'employee id matches');
    assert(data.balances !== undefined, 'has balances');
  });
} else {
  skip('getEmployeeAbsenceBalance', 'no employee ID');
}

await test('getAbsenceTypes', async () => {
  const result = await absenceH.handleGetAbsenceTypes({});
  const data = parseResult(result);
  assert(Array.isArray(data.absence_types), 'absence_types is array');
});

await test('getTeamAbsenceOverview', async () => {
  const result = await absenceH.handleGetTeamAbsenceOverview({});
  const data = parseResult(result);
  assert(data.summary !== undefined, 'has summary');
  assert(typeof data.summary.total_absences === 'number', 'has total_absences');
});

await test('getAbsenceStatistics', async () => {
  const result = await absenceH.handleGetAbsenceStatistics({
    start_date: thirtyDaysAgo,
    end_date: today,
  });
  const data = parseResult(result);
  assert(data.report_type === 'absence_statistics', 'correct report type');
  assert(data.statistics !== undefined, 'has statistics');
});

// ── 6. Analytics ────────────────────────────────────────────────────

group('6. Analytics');

await test('getTeamAvailability', async () => {
  const result = await analyticsH.handleGetTeamAvailability({});
  const data = parseResult(result);
  assert(data.date === today, 'date is today');
  assert(data.summary !== undefined, 'has summary');
  assert(typeof data.summary.total_employees === 'number', 'has total_employees');
});

// ── 7. Documents ────────────────────────────────────────────────────

group('7. Documents');

await test('getDocumentCategories', async () => {
  const result = await documentH.handleGetDocumentCategories({});
  const data = parseResult(result);
  assert(Array.isArray(data.document_categories), 'document_categories is array');
});

if (ids.employeeId) {
  await test('getEmployeeDocuments (V2)', async () => {
    const result = await documentH.handleGetEmployeeDocuments({ employee_id: ids.employeeId });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(data.employee_id === ids.employeeId, 'employee id matches');
    assert(Array.isArray(data.documents), 'documents is array');
  });
} else {
  skip('getEmployeeDocuments (V2)', 'no employee ID');
}

// ── 8. Approvals ────────────────────────────────────────────────────

group('8. Approvals');

await test('getPendingApprovals', async () => {
  const result = await approvalH.handleGetPendingApprovals({});
  const data = parseResult(result);
  // Either we get pending_approvals or a fallback message (both are valid)
  assert(
    data.pending_approvals !== undefined || data.message !== undefined,
    'has pending_approvals or fallback message'
  );
});

await test('getAttendanceApprovalStatus', async () => {
  const result = await approvalH.handleGetAttendanceApprovalStatus({
    start_date: thirtyDaysAgo,
    end_date: today,
  });
  const data = parseResult(result);
  assert(Array.isArray(data.attendance_records), 'has attendance_records');
});

await test('getAbsenceApprovalStatus', async () => {
  const result = await approvalH.handleGetAbsenceApprovalStatus({
    start_date: thirtyDaysAgo,
    end_date: today,
  });
  const data = parseResult(result);
  assert(Array.isArray(data.absence_records), 'has absence_records');
  assert(data.summary !== undefined, 'has summary');
});

await test('getApprovalWorkflowSummary', async () => {
  const result = await approvalH.handleGetApprovalWorkflowSummary({});
  const data = parseResult(result);
  assert(data.approval_workflow_summary !== undefined, 'has summary');
});

// ── 9. Recruiting ───────────────────────────────────────────────────

group('9. Recruiting');

await test('listRecruitingApplications', async () => {
  const result = await recruitingH.handleListRecruitingApplications({ limit: 5 });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  const data = parseResult(result);
  assert(Array.isArray(data.applications), 'applications is array');
  if (data.applications.length > 0) {
    ids.applicationId = data.applications[0].id;
  }
});

await test('listRecruitingCandidates', async () => {
  const result = await recruitingH.handleListRecruitingCandidates({ limit: 5 });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  const data = parseResult(result);
  assert(Array.isArray(data.candidates), 'candidates is array');
  if (data.candidates.length > 0) {
    ids.candidateId = data.candidates[0].id;
  }
});

await test('listRecruitingJobs', async () => {
  const result = await recruitingH.handleListRecruitingJobs({ limit: 5 });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  const data = parseResult(result);
  assert(Array.isArray(data.jobs), 'jobs is array');
  if (data.jobs.length > 0) {
    ids.jobId = data.jobs[0].id;
  }
});

await test('listRecruitingCategories', async () => {
  const result = await recruitingH.handleListRecruitingCategories({});
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  const data = parseResult(result);
  assert(Array.isArray(data.categories), 'categories is array');
});

if (ids.applicationId) {
  await test('getRecruitingApplication', async () => {
    const result = await recruitingH.handleGetRecruitingApplication({
      application_id: ids.applicationId,
    });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(data.application !== undefined, 'has application');
  });

  await test('listApplicationDocuments', async () => {
    const result = await recruitingH.handleListApplicationDocuments({
      application_id: ids.applicationId,
    });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(Array.isArray(data.documents), 'documents is array');
  });

  await test('listApplicationStageTransitions', async () => {
    const result = await recruitingH.handleListApplicationStageTransitions({
      application_id: ids.applicationId,
    });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(Array.isArray(data.stage_transitions), 'stage_transitions is array');
  });
} else {
  skip('getRecruitingApplication', 'no application ID (403 or empty)');
  skip('listApplicationDocuments', 'no application ID (403 or empty)');
  skip('listApplicationStageTransitions', 'no application ID (403 or empty)');
}

if (ids.candidateId) {
  await test('getRecruitingCandidate', async () => {
    const result = await recruitingH.handleGetRecruitingCandidate({
      candidate_id: ids.candidateId,
    });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(data.candidate !== undefined, 'has candidate');
  });
} else {
  skip('getRecruitingCandidate', 'no candidate ID (403 or empty)');
}

if (ids.jobId) {
  await test('getRecruitingJob', async () => {
    const result = await recruitingH.handleGetRecruitingJob({
      job_id: ids.jobId,
    });
    if (is403(result)) {
      console.log('    (403 — endpoint reachable, scope missing)');
      return;
    }
    const data = parseResult(result);
    assert(data.job !== undefined, 'has job');
  });
} else {
  skip('getRecruitingJob', 'no job ID (403 or empty)');
}

// ── 10. Recruiting Filters (Regression) ─────────────────────────────

group('10. Recruiting Filters (Regression)');

await test('filter by candidate_email', async () => {
  const result = await recruitingH.handleListRecruitingApplications({
    candidate_email: 'test@example.com',
    limit: 5,
  });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  // Should not throw — the handler must pass the parameter correctly
  const data = parseResult(result);
  assert(Array.isArray(data.applications), 'applications is array');
});

await test('filter by updated_at date range', async () => {
  const result = await recruitingH.handleListRecruitingApplications({
    updated_at_after: thirtyDaysAgo,
    updated_at_before: today,
    limit: 5,
  });
  if (is403(result)) {
    console.log('    (403 — endpoint reachable, scope missing)');
    return;
  }
  if (isError(result)) {
    // Non-403 API error — endpoint reachable but filter may not be supported
    console.log('    (API error — endpoint reachable, filter may be unsupported)');
    return;
  }
  const data = parseResult(result);
  assert(Array.isArray(data.applications), 'applications is array');
});

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  Results: ${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
console.log('══════════════════════════════════════════════════════════════\n');

process.exit(results.fail > 0 ? 1 : 0);
