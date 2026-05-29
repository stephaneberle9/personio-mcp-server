/**
 * Unit tests for PersonioClient.formatEmployeeData.
 *
 * These run offline against the compiled build (no API calls, no credentials).
 * They lock in the generic all-attributes behaviour:
 *   (i)   a dynamic_<id> field in DYNAMIC_FIELD_MAP is exposed under its
 *         readable name,
 *   (ii)  falsy values (0, false, "") are preserved, not dropped,
 *   (iii) unknown attributes pass through under their original key.
 *
 * Usage: npm run build && node --test test-format-employee.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { PersonioClient } from './build/api/personio-client.js';

// Constructing the client does not perform any network/auth calls.
const client = new PersonioClient({ clientId: 'test', clientSecret: 'test' });

function makeEmployee(extraAttrs = {}) {
  return {
    type: 'Employee',
    attributes: {
      id: { label: 'ID', value: 42 },
      first_name: { label: 'First name', value: 'Ada' },
      last_name: { label: 'Last name', value: 'Lovelace' },
      email: { label: 'Email', value: 'ada@example.com' },
      status: { label: 'Status', value: 'active' },
      position: { label: 'Position', value: 'Engineer' },
      department: {
        label: 'Department',
        value: { type: 'Department', attributes: { id: 1, name: 'R&D' } },
      },
      office: {
        label: 'Office',
        value: { type: 'Office', attributes: { id: 2, name: 'Berlin' } },
      },
      hire_date: { label: 'Hire date', value: '2020-01-01' },
      weekly_working_hours: { label: 'Weekly hours', value: '40' },
      ...extraAttrs,
    },
  };
}

test('(i) dynamic field in DYNAMIC_FIELD_MAP is exposed under its readable name', () => {
  const result = client.formatEmployeeData(
    makeEmployee({ dynamic_14285869: { label: 'Shoe size', value: 43 } })
  );

  assert.equal(result.shoe_size, 43, 'dynamic_14285869 should map to shoe_size');
  assert.equal(
    result.dynamic_14285869,
    undefined,
    'the cryptic dynamic_<id> key should not leak through once mapped'
  );
});

test('(ii) falsy values (0, false, "") are preserved, not dropped', () => {
  const result = client.formatEmployeeData(
    makeEmployee({
      overtime_hours: { label: 'Overtime', value: 0 },
      is_on_trial: { label: 'On trial', value: false },
      middle_name: { label: 'Middle name', value: '' },
    })
  );

  assert.strictEqual(result.overtime_hours, 0, '0 must be preserved');
  assert.strictEqual(result.is_on_trial, false, 'false must be preserved');
  assert.strictEqual(result.middle_name, '', 'empty string must be preserved');
});

test('(iii) unknown attributes pass through under their original key', () => {
  const result = client.formatEmployeeData(
    makeEmployee({ cost_center: { label: 'Cost center', value: 'CC-100' } })
  );

  assert.equal(result.cost_center, 'CC-100');
});

test('known friendly aliases are still derived', () => {
  const result = client.formatEmployeeData(makeEmployee());

  assert.equal(result.id, 42);
  assert.equal(result.name, 'Ada Lovelace');
  assert.equal(result.email, 'ada@example.com');
  assert.equal(result.department, 'R&D', 'nested department name should be extracted');
  assert.equal(result.office, 'Berlin', 'nested office name should be extracted');
  assert.equal(result.weekly_hours, '40');
});

test('PERSONIO_DYNAMIC_FIELD_MAP env var extends/overrides the default map', () => {
  // The map is resolved at module load, so exercise the override in a fresh
  // child process with the env var set.
  const script = `
    import assert from 'node:assert/strict';
    import { PersonioClient } from './build/api/personio-client.js';
    const client = new PersonioClient({ clientId: 't', clientSecret: 't' });
    const result = client.formatEmployeeData({
      type: 'Employee',
      attributes: {
        id: { label: 'ID', value: 1 },
        first_name: { label: 'First', value: 'A' },
        last_name: { label: 'Last', value: 'B' },
        dynamic_99999999: { label: 'Cost center', value: 'CC-7' },
      },
    });
    assert.equal(result.cost_center, 'CC-7');
    assert.equal(result.dynamic_99999999, undefined);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      PERSONIO_DYNAMIC_FIELD_MAP: '{"dynamic_99999999":"cost_center"}',
    },
    stdio: 'pipe',
  });
});
