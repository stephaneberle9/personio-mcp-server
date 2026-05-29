/**
 * Tests for the offset/limit pagination enforcement on the "style A" list tools.
 * These run offline against the compiled build (no API calls, no credentials),
 * stubbing the PersonioClient fetch methods.
 *
 * The central guarantee under test: pagination is applied EXACTLY ONCE per
 * request. Personio honors offset/limit server-side on these endpoints, so:
 *   - UNFILTERED requests forward offset/limit and trust the server's page; the
 *     client only defensively clamps `limit` and NEVER re-applies `offset`.
 *   - FILTERED requests (e.g. an `office` filter, or `search_employees`' query)
 *     fetch the COMPLETE set, filter, then slice once.
 *
 * Several tests here MUST fail against the prior double-applied implementation
 * (which forwarded offset/limit AND re-sliced by the same offset), e.g. the
 * "middle page is not empty", contiguity, and identity tests.
 *
 * Usage: npm run build && node --test test-pagination.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOffsetLimit,
  paginateStyleA,
  clampLimit,
  clampOffset,
} from './build/utils/pagination.js';
import { PersonioClient } from './build/api/personio-client.js';
import { EmployeeHandlers } from './build/handlers/employee-handlers.js';
import { RecruitingHandlers } from './build/handlers/recruiting-handlers.js';

// Constructing the client performs no network/auth calls.
function makeClient() {
  return new PersonioClient({ clientId: 't', clientSecret: 't' });
}

// Minimal Employee shape understood by the real formatEmployeeData. Pass an
// `office`/`department`/`position` name to attach those attributes, and `extra`
// to attach arbitrary raw attributes (e.g. PII fields, for projection tests).
function makeEmployee(id, firstName, lastName, { office, department, position, extra } = {}) {
  const attributes = {
    id: { label: 'ID', value: id },
    first_name: { label: 'First name', value: firstName },
    last_name: { label: 'Last name', value: lastName },
    email: { label: 'Email', value: `${firstName}.${lastName}@example.com`.toLowerCase() },
  };
  if (office !== undefined) {
    attributes.office = {
      label: 'Office',
      value: { type: 'Office', attributes: { id: 1, name: office } },
    };
  }
  if (department !== undefined) {
    attributes.department = {
      label: 'Department',
      value: { type: 'Department', attributes: { id: 1, name: department } },
    };
  }
  if (position !== undefined) {
    attributes.position = { label: 'Position', value: position };
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    attributes[key] = { label: key, value };
  }
  return { type: 'Employee', attributes };
}

function makeDataset(n) {
  return Array.from({ length: n }, (_, i) => makeEmployee(i + 1, `First${i}`, `Last${i}`));
}

// A getEmployees stub that honors offset/limit server-side, exactly as Personio
// does. This is the realistic case the fix targets.
function serverPaginatedGetEmployees(dataset) {
  return async ({ limit, offset } = {}) => {
    const start = offset ?? 0;
    const end = limit !== undefined ? start + limit : undefined;
    return {
      success: true,
      data: dataset.slice(start, end),
      metadata: { total_elements: dataset.length },
    };
  };
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// applyOffsetLimit / clamp helpers
// ---------------------------------------------------------------------------

test('applyOffsetLimit: slices to the requested page', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const { items: page, offset, limit } = applyOffsetLimit(
    items,
    { offset: 10, limit: 5 },
    { defaultLimit: 50, maxLimit: 200 }
  );
  assert.deepEqual(page, [10, 11, 12, 13, 14]);
  assert.equal(offset, 10);
  assert.equal(limit, 5);
});

test('applyOffsetLimit: never returns more than the limit', () => {
  const items = Array.from({ length: 661 }, (_, i) => i);
  const { items: page } = applyOffsetLimit(items, { limit: 25 }, { defaultLimit: 200, maxLimit: 200 });
  assert.equal(page.length, 25);
});

test('applyOffsetLimit: missing limit falls back to the default', () => {
  const items = Array.from({ length: 300 }, (_, i) => i);
  const { items: page, limit } = applyOffsetLimit(items, {}, { defaultLimit: 50, maxLimit: 200 });
  assert.equal(limit, 50);
  assert.equal(page.length, 50);
});

test('clampLimit: clamps above max and below min, floors fractions', () => {
  const bounds = { defaultLimit: 50, maxLimit: 200 };
  assert.equal(clampLimit(9999, bounds), 200);
  assert.equal(clampLimit(0, bounds), 1);
  assert.equal(clampLimit(10.9, bounds), 10);
  assert.equal(clampLimit(undefined, bounds), 50);
  assert.equal(clampLimit(NaN, bounds), 50);
});

test('clampOffset: negatives/invalid become 0, fractions floored', () => {
  assert.equal(clampOffset(-5), 0);
  assert.equal(clampOffset(undefined), 0);
  assert.equal(clampOffset(7.8), 7);
  assert.equal(clampOffset(NaN), 0);
});

// ---------------------------------------------------------------------------
// paginateStyleA: the single-application decision point
// ---------------------------------------------------------------------------

test("paginateStyleA server mode: does NOT re-apply offset (the double-apply bug)", () => {
  // `items` is the page the server already returned for offset=5,limit=5.
  // Re-applying offset=5 would slice it to empty — the exact prior bug.
  const serverPage = [5, 6, 7, 8, 9];
  const { items, offset, limit, total } = paginateStyleA(
    serverPage,
    { offset: 5, limit: 5 },
    { defaultLimit: 200, maxLimit: 200 },
    { mode: 'server', total: 20 }
  );
  assert.deepEqual(items, [5, 6, 7, 8, 9], 'server page passes through unchanged');
  assert.equal(offset, 5, 'offset is echoed');
  assert.equal(limit, 5);
  assert.equal(total, 20, 'total comes from the server-reported total');
});

test('paginateStyleA server mode: defensively truncates a too-large page to limit', () => {
  const oversized = Array.from({ length: 661 }, (_, i) => i);
  const { items, total } = paginateStyleA(
    oversized,
    { limit: 25 },
    { defaultLimit: 200, maxLimit: 200 },
    { mode: 'server', total: 661 }
  );
  assert.equal(items.length, 25, 'truncated to the limit when the server ignored it');
  assert.deepEqual(items, Array.from({ length: 25 }, (_, i) => i), 'kept the first `limit`, no offset re-applied');
  assert.equal(total, 661);
});

test('paginateStyleA client mode: slices the full set exactly once', () => {
  const fullSet = Array.from({ length: 20 }, (_, i) => i);
  const { items, offset, limit, total } = paginateStyleA(
    fullSet,
    { offset: 5, limit: 5 },
    { defaultLimit: 200, maxLimit: 200 },
    { mode: 'client' }
  );
  assert.deepEqual(items, [5, 6, 7, 8, 9], 'offset+limit applied once to the full set');
  assert.equal(offset, 5);
  assert.equal(limit, 5);
  assert.equal(total, 20, 'total is the full match count before slicing');
});

// ---------------------------------------------------------------------------
// list_employees (unfiltered): server-side pagination applied exactly once
// ---------------------------------------------------------------------------

test('list_employees: offset >= limit returns the correct middle page, not empty', async () => {
  // The headline regression: total=20, offset=5, limit=5 must return records
  // 5–9, NOT an empty page (which the double-applied code produced).
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(makeDataset(20));

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleListEmployees({ offset: 5, limit: 5 }));

  assert.equal(body.employees.length, 5, 'middle page is not empty');
  assert.deepEqual(body.employees.map(e => e.id), [6, 7, 8, 9, 10], 'records at absolute indices 5–9');
  assert.equal(body.count, 5);
  assert.equal(body.offset, 5);
  assert.equal(body.limit, 5);
  assert.equal(body.total, 20);
});

test('list_employees: pages are contiguous and non-overlapping vs a full fetch', async () => {
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(makeDataset(20));
  const handlers = new EmployeeHandlers(client);

  const L = 5;
  const pageA = parse(await handlers.handleListEmployees({ offset: 0, limit: L }));
  const pageB = parse(await handlers.handleListEmployees({ offset: L, limit: L }));
  const full = parse(await handlers.handleListEmployees({ offset: 0, limit: 200 }));

  const aIds = pageA.employees.map(e => e.id);
  const bIds = pageB.employees.map(e => e.id);

  // Disjoint.
  assert.equal(new Set([...aIds, ...bIds]).size, aIds.length + bIds.length, 'pages do not overlap');
  // Contiguous: A followed by B equals the first 2L of a full unpaginated fetch.
  assert.deepEqual([...aIds, ...bIds], full.employees.slice(0, 2 * L).map(e => e.id), 'pages are contiguous');
});

test('list_employees: the record at a given offset equals the same-index full-fetch record', async () => {
  // Identity check — proves offset is applied once, not doubled.
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(makeDataset(20));
  const handlers = new EmployeeHandlers(client);

  const full = parse(await handlers.handleListEmployees({ offset: 0, limit: 200 }));
  for (const offset of [0, 1, 7, 13, 19]) {
    const body = parse(await handlers.handleListEmployees({ offset, limit: 1 }));
    assert.equal(body.employees[0].id, full.employees[offset].id, `offset=${offset} matches full[${offset}]`);
    assert.equal(body.offset, offset);
  }
});

test('list_employees: defensively clamps an oversized response to the limit', async () => {
  // If the server were to ignore limit and return everything, the client still
  // caps the page at `limit` (but never re-applies offset client-side).
  const client = makeClient();
  client.getEmployees = async () => ({
    success: true,
    data: makeDataset(661),
    metadata: { total_elements: 661 },
  });

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleListEmployees({ limit: 25 }));

  assert.equal(body.employees.length, 25, 'page is capped at the limit');
  assert.equal(body.count, 25);
  assert.equal(body.total, 661, 'total reflects the full count from API metadata');
  assert.equal(body.offset, 0);
  assert.equal(body.limit, 25);
});

test('list_employees: CSV and JSON return the same sliced set', async () => {
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(makeDataset(20));
  const handlers = new EmployeeHandlers(client);

  const json = parse(await handlers.handleListEmployees({ offset: 5, limit: 5 }));
  const csvResult = await handlers.handleListEmployees({ offset: 5, limit: 5, format: 'csv' });
  const csv = csvResult.content[0].text;

  for (const emp of json.employees) {
    assert.ok(csv.includes(emp.email), `CSV contains ${emp.email} from the JSON page`);
  }
  // The CSV must not leak a record outside the JSON page.
  assert.ok(!csv.includes('first0.last0@example.com'), 'CSV excludes records before the offset');
});

// ---------------------------------------------------------------------------
// list_employees (filtered by office): pagination applies to the FILTERED set
// ---------------------------------------------------------------------------

test('list_employees: with an office filter, pagination applies to the filtered set', async () => {
  // 450 employees spanning multiple raw pages (forcing getAllEmployees to page
  // through all of them); every 10th is in Berlin → 45 matches. This also guards
  // the getAllEmployees fix: filtering must NOT terminate paging early.
  const dataset = Array.from({ length: 450 }, (_, i) =>
    makeEmployee(i + 1, `First${i}`, `Last${i}`, { office: i % 10 === 0 ? 'Berlin' : 'Munich' })
  );
  const berlinIds = dataset
    .filter((_, i) => i % 10 === 0)
    .map(e => e.attributes.id.value);

  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);
  const handlers = new EmployeeHandlers(client);

  const body = parse(await handlers.handleListEmployees({ office: 'Berlin', limit: 10, offset: 20 }));

  assert.equal(body.total, 45, 'total is the filtered (Berlin) count, not the tenant-wide total');
  assert.equal(body.count, 10, 'page size reflects the filtered set');
  assert.deepEqual(
    body.employees.map(e => e.id),
    berlinIds.slice(20, 30),
    'the page is the offset/limit slice of the FILTERED set'
  );
});

// ---------------------------------------------------------------------------
// search_employees: full-set scan + result-cap semantics, applied once
// ---------------------------------------------------------------------------

test('search_employees: finds a unique match beyond the first server page (full-set scan)', async () => {
  // 450 employees across multiple server pages; the only match sits at index
  // 300 (page 2 with pageSize=200). search must page through the FULL set via
  // getAllEmployees — a single server page would miss it.
  const dataset = makeDataset(450);
  dataset[300] = makeEmployee(9999, 'Zzunique', 'Needle');
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleSearchEmployees({ query: 'zzunique', limit: 50 }));

  assert.equal(body.total, 1, 'exactly one match across the full set');
  assert.equal(body.count, 1);
  assert.equal(body.results[0].id, 9999, 'the match on the second server page is found');
});

test('search_employees: caps results at limit and reports the full match total', async () => {
  // 120 employees all share the surname "Lovelace" → all match the query.
  const employees = Array.from({ length: 120 }, (_, i) => makeEmployee(i + 1, `Ada${i}`, 'Lovelace'));
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(employees);

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleSearchEmployees({ query: 'lovelace', limit: 50 }));

  assert.equal(body.results.length, 50, 'results are capped at the limit');
  assert.equal(body.count, 50);
  assert.equal(body.total, 120, 'total reflects all matches before slicing');
});

// ---------------------------------------------------------------------------
// search_employees: `attributes` field selection / data minimization
// ---------------------------------------------------------------------------

// An employee carrying sensitive PII fields, so projection tests can assert
// those fields are NOT leaked when the caller did not request them.
function makePiiEmployee(id, firstName, lastName, opts = {}) {
  return makeEmployee(id, firstName, lastName, {
    department: opts.department,
    position: opts.position,
    extra: {
      date_of_birth: '1990-01-01',
      private_email: `${firstName}.private@personal.example`.toLowerCase(),
      salary: 95000,
      ...(opts.extra ?? {}),
    },
  });
}

test('search_employees: attributes=["name","department"] returns only those fields (plus id), no PII', async () => {
  const dataset = [
    makePiiEmployee(1, 'Grace', 'Hopper', { department: 'Engineering', position: 'Admiral' }),
    makePiiEmployee(2, 'Alan', 'Turing', { department: 'Research', position: 'Cryptanalyst' }),
  ];
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleSearchEmployees({ query: 'grace', attributes: ['name', 'department'] }));

  assert.equal(body.results.length, 1);
  const [result] = body.results;
  assert.deepEqual(
    Object.keys(result).sort(),
    ['department', 'id', 'name'],
    'exactly id + the requested name/department, nothing else'
  );
  assert.equal(result.name, 'Grace Hopper');
  assert.equal(result.department, 'Engineering');
  // Sensitive PII must be absent from the projected result.
  for (const leak of ['date_of_birth', 'private_email', 'salary', 'email', 'position']) {
    assert.equal(result[leak], undefined, `projected result must not expose ${leak}`);
  }
});

test('search_employees: matches on department even when attributes excludes it (match fields fetched internally)', async () => {
  // The caller asks ONLY for ["name"] but queries by department. The match field
  // must still be fetched and evaluated internally, then dropped from output.
  const dataset = [
    makePiiEmployee(1, 'Katherine', 'Johnson', { department: 'Aerospace' }),
    makePiiEmployee(2, 'Dorothy', 'Vaughan', { department: 'Computing' }),
  ];
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleSearchEmployees({ query: 'aerospace', attributes: ['name'] }));

  assert.equal(body.total, 1, 'matched on department despite it being excluded from attributes');
  assert.equal(body.results.length, 1);
  const [result] = body.results;
  assert.deepEqual(Object.keys(result).sort(), ['id', 'name'], 'output reduced to id + name');
  assert.equal(result.name, 'Katherine Johnson');
  assert.equal(result.department, undefined, 'the match-only department field is dropped from output');
});

test('search_employees: omitting attributes returns the full record (backward compat)', async () => {
  const dataset = [makePiiEmployee(1, 'Ada', 'Lovelace', { department: 'Analytical', position: 'Mathematician' })];
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);

  const handlers = new EmployeeHandlers(client);
  const body = parse(await handlers.handleSearchEmployees({ query: 'ada' }));

  assert.equal(body.results.length, 1);
  const [result] = body.results;
  // Full record: friendly aliases AND all passed-through attributes incl. PII.
  for (const key of ['id', 'name', 'email', 'department', 'position', 'date_of_birth', 'private_email', 'salary']) {
    assert.ok(key in result, `full record includes ${key}`);
  }
});

test('search_employees: a raw key and a resolved name both work in attributes', async () => {
  const dataset = [makePiiEmployee(1, 'Radia', 'Perlman', { department: 'Networking' })];
  const client = makeClient();
  client.getEmployees = serverPaginatedGetEmployees(dataset);
  const handlers = new EmployeeHandlers(client);

  // Resolved/derived name → the `name` output field.
  const byName = parse(await handlers.handleSearchEmployees({ query: 'radia', attributes: ['name'] }));
  assert.deepEqual(Object.keys(byName.results[0]).sort(), ['id', 'name']);
  assert.equal(byName.results[0].name, 'Radia Perlman');

  // Raw key → its own passed-through field (plus the always-on id + name).
  const byRaw = parse(await handlers.handleSearchEmployees({ query: 'radia', attributes: ['first_name'] }));
  assert.deepEqual(Object.keys(byRaw.results[0]).sort(), ['first_name', 'id', 'name']);
  assert.equal(byRaw.results[0].first_name, 'Radia');
});

// ---------------------------------------------------------------------------
// style B (cursor): cursor passthrough + next_cursor preserved, no slicing
// ---------------------------------------------------------------------------

test('list_recruiting_applications: forwards cursor and preserves next_cursor unchanged', async () => {
  const client = makeClient();
  let forwardedCursor;
  let forwardedLimit;
  client.getRecruitingApplications = async (params) => {
    forwardedCursor = params?.cursor;
    forwardedLimit = params?.limit;
    return {
      _data: [
        { id: 'a1', candidate: { id: 'c1', first_name: 'A', last_name: 'B', email: 'a@b.c' } },
        { id: 'a2', candidate: { id: 'c2', first_name: 'C', last_name: 'D', email: 'c@d.e' } },
        { id: 'a3', candidate: { id: 'c3', first_name: 'E', last_name: 'F', email: 'e@f.g' } },
      ],
      _meta: { links: { next: { href: 'CURSOR_TOKEN_XYZ' } } },
    };
  };

  const handlers = new RecruitingHandlers(client);
  const body = parse(await handlers.handleListRecruitingApplications({ cursor: 'PREV_CURSOR', limit: 2 }));

  assert.equal(forwardedCursor, 'PREV_CURSOR', 'the caller cursor is forwarded to the API');
  assert.equal(forwardedLimit, 2, 'the caller limit is forwarded to the API (server-honored)');
  assert.equal(body.next_cursor, 'CURSOR_TOKEN_XYZ', 'next_cursor is surfaced verbatim');
  // Cursor endpoints must NOT be client-side sliced: all rows the API returned
  // are passed through (the server already applied the page size).
  assert.equal(body.applications.length, 3, 'no client-side slicing of cursor results');
  assert.equal(body.total, 3);
});

test('list_recruiting_applications: null next_cursor is preserved (not fabricated)', async () => {
  const client = makeClient();
  client.getRecruitingApplications = async () => ({ _data: [], _meta: undefined });

  const handlers = new RecruitingHandlers(client);
  const body = parse(await handlers.handleListRecruitingApplications({}));

  assert.equal(body.next_cursor, null, 'absent next link surfaces as null, never invented');
});
