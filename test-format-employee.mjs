/**
 * Unit tests for PersonioClient.formatEmployeeData.
 *
 * These run offline against the compiled build (no API calls, no credentials).
 * They lock in the generic all-attributes behavior:
 *   (i)   a dynamic_<id> field in DYNAMIC_FIELD_MAP is exposed under its
 *         readable name,
 *   (ii)  falsy values (0, false, "") are preserved, not dropped,
 *   (iii) unknown attributes pass through under their original key,
 *   (iv)  an unmapped dynamic_<id> field derives its key from its label,
 *   (v)   an explicit map entry overrides the label-derived key,
 *   (vi)  colliding derived keys fall back to the raw key (no silent drop).
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

test('(iv) unmapped dynamic_<id> field derives its key from its (German) label', () => {
  const result = client.formatEmployeeData(
    makeEmployee({
      dynamic_10913352: { label: 'Kostenstelle kurz', value: 'CC-12' },
      dynamic_82888: { label: 'Mobil (itemis)', value: '+49 170 0000000' },
    })
  );

  assert.equal(result.kostenstelle_kurz, 'CC-12', 'label should be slugified into the key');
  assert.equal(result.mobil_itemis, '+49 170 0000000');
  assert.equal(result.dynamic_10913352, undefined, 'the cryptic key should not also leak through');
});

test('(iv) dynamic_<id> field without a usable label keeps its raw key', () => {
  const result = client.formatEmployeeData(
    makeEmployee({ dynamic_777: { label: '', value: 'kept' } })
  );

  assert.equal(result.dynamic_777, 'kept', 'no label → fall back to the raw dynamic_<id> key');
});

test('(vi) two labels slugging to the same name: second falls back to its raw key', () => {
  const result = client.formatEmployeeData(
    makeEmployee({
      dynamic_1: { label: 'Cost Center', value: 'first' },
      dynamic_2: { label: 'cost center', value: 'second' },
    })
  );

  // First wins the slug; the second must not silently overwrite or vanish.
  assert.equal(result.cost_center, 'first');
  assert.equal(result.dynamic_2, 'second', 'colliding field is preserved under its raw key');
});

test('(vi) a derived key colliding with a friendly alias falls back to the raw key', () => {
  const result = client.formatEmployeeData(
    makeEmployee({ dynamic_3: { label: 'Status', value: 'custom-status' } })
  );

  // The friendly alias derived above must win; the dynamic field is preserved
  // under its raw key rather than clobbering `status`.
  assert.equal(result.status, 'active', 'the friendly alias is not overwritten');
  assert.equal(result.dynamic_3, 'custom-status', 'colliding dynamic field kept under its raw key');
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
        // (v) the label would slugify to 'kostenstelle', but the explicit map
        // entry must win and surface the field under 'cost_center'.
        dynamic_99999999: { label: 'Kostenstelle', value: 'CC-7' },
      },
    });
    assert.equal(result.cost_center, 'CC-7', 'explicit map overrides the label-derived key');
    assert.equal(result.kostenstelle, undefined, 'label-derived key is not also emitted');
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
