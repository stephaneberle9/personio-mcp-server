/**
 * Unit tests for the attribute-schema helpers that power the
 * list_employee_attributes discovery tool and the request-side translation of
 * resolved output names back to raw Personio keys.
 *
 * These run offline against the compiled build (no API calls, no credentials):
 *   - buildAttributeSchema mirrors formatEmployeeData's key resolution
 *     (explicit map > slugified label > raw key) and collision handling, and
 *     tags each attribute with its source.
 *   - buildReverseAttributeIndex maps output/friendly names back to raw key(s),
 *     so callers can pass either form to `attributes`.
 *   - getAttributeSchema caches the schema for a configurable TTL and refetches
 *     it afterwards, so a long-running server eventually picks up label/field
 *     changes (network is stubbed here).
 *
 * Usage: npm run build && node --test test-attribute-schema.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PersonioClient,
  buildAttributeSchema,
  buildReverseAttributeIndex,
} from './build/api/personio-client.js';

/**
 * A client whose network fetch is stubbed to count calls, so cache behavior can
 * be exercised offline. Constructing the client performs no network/auth calls.
 */
function makeStubbedClient(attributeCacheTtlMs) {
  const client = new PersonioClient({ clientId: 't', clientSecret: 't', attributeCacheTtlMs });
  let fetches = 0;
  client.getEmployees = async () => {
    fetches += 1;
    return {
      success: true,
      data: [{ type: 'Employee', attributes: { id: { label: 'ID', value: 1 } } }],
    };
  };
  return { client, fetches: () => fetches };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_ATTRS = {
  id: { label: 'ID', value: 1 },
  first_name: { label: 'First name', value: 'Ada' },
  last_name: { label: 'Last name', value: 'Lovelace' },
  email: { label: 'Email', value: 'ada@example.com' },
  weekly_working_hours: { label: 'Weekly hours', value: '40' },
  cost_centers: { label: 'Cost center', value: [] },
  dynamic_10913352: { label: 'Kostenstelle kurz', value: 'CC-1' },
  dynamic_14285869: { label: 'Schuhgröße', value: 43 }, // in the default map
  dynamic_777: { label: '', value: 'x' }, // no label → raw key
  dynamic_999: { label: 'Status', value: 'y' }, // slug collides with a reserved alias
};

function schemaFor(attrs = SAMPLE_ATTRS) {
  return buildAttributeSchema(attrs);
}

function find(schema, key) {
  return schema.find((a) => a.key === key);
}

test('buildAttributeSchema: label-derived dynamic field reports a "label" source', () => {
  const info = find(schemaFor(), 'dynamic_10913352');
  assert.equal(info.output_key, 'kostenstelle_kurz');
  assert.equal(info.source, 'label');
  assert.equal(info.label, 'Kostenstelle kurz');
  assert.equal(info.type, 'string');
});

test('buildAttributeSchema: explicitly mapped dynamic field reports a "map" source', () => {
  const info = find(schemaFor(), 'dynamic_14285869');
  assert.equal(info.output_key, 'shoe_size');
  assert.equal(info.source, 'map');
  assert.equal(info.type, 'number');
});

test('buildAttributeSchema: dynamic field without a label keeps its raw key', () => {
  const info = find(schemaFor(), 'dynamic_777');
  assert.equal(info.output_key, 'dynamic_777');
  assert.equal(info.source, 'key');
  assert.equal(info.label, null, 'blank label is reported as null');
});

test('buildAttributeSchema: a label colliding with a reserved alias falls back to the raw key', () => {
  // "Status" would slugify to `status`, which formatEmployeeData reserves as a
  // friendly alias — so the dynamic field must keep its raw key.
  const info = find(schemaFor(), 'dynamic_999');
  assert.equal(info.output_key, 'dynamic_999');
  assert.equal(info.source, 'key');
});

test('buildAttributeSchema: standard (non-dynamic) keys pass through unchanged', () => {
  const info = find(schemaFor(), 'cost_centers');
  assert.equal(info.output_key, 'cost_centers');
  assert.equal(info.source, 'key');
  assert.equal(info.type, 'array');
});

test('buildReverseAttributeIndex: friendly aliases map back to their raw key(s)', () => {
  const reverse = buildReverseAttributeIndex(schemaFor());
  assert.deepEqual(reverse.get('name'), ['first_name', 'last_name']);
  assert.deepEqual(reverse.get('weekly_hours'), ['weekly_working_hours']);
});

test('buildReverseAttributeIndex: resolved output names map back to the raw dynamic key', () => {
  const reverse = buildReverseAttributeIndex(schemaFor());
  assert.deepEqual(reverse.get('kostenstelle_kurz'), ['dynamic_10913352']);
  assert.deepEqual(reverse.get('shoe_size'), ['dynamic_14285869']);
});

test('buildReverseAttributeIndex: a raw key maps to itself', () => {
  const reverse = buildReverseAttributeIndex(schemaFor());
  assert.deepEqual(reverse.get('email'), ['email']);
  assert.deepEqual(reverse.get('dynamic_10913352'), ['dynamic_10913352']);
});

test('buildReverseAttributeIndex: unknown names are absent (callers pass them through)', () => {
  const reverse = buildReverseAttributeIndex(schemaFor());
  assert.equal(reverse.get('not_a_real_field'), undefined);
});

test('getAttributeSchema: caches within the TTL (single fetch)', async () => {
  const { client, fetches } = makeStubbedClient(60_000);
  await client.getAttributeSchema();
  await client.getAttributeSchema();
  assert.equal(fetches(), 1, 'second call within TTL is served from cache');
});

test('getAttributeSchema: concurrent first callers share one in-flight fetch', async () => {
  const { client, fetches } = makeStubbedClient(60_000);
  await Promise.all([client.getAttributeSchema(), client.getAttributeSchema(), client.getAttributeSchema()]);
  assert.equal(fetches(), 1, 'in-flight fetch is shared');
});

test('getAttributeSchema: refetches after the TTL expires', async () => {
  const { client, fetches } = makeStubbedClient(20);
  await client.getAttributeSchema();
  await sleep(40);
  await client.getAttributeSchema();
  assert.equal(fetches(), 2, 'expired cache is refetched');
});

test('getAttributeSchema: TTL of 0 disables caching (always refetch)', async () => {
  const { client, fetches } = makeStubbedClient(0);
  await client.getAttributeSchema();
  await client.getAttributeSchema();
  assert.equal(fetches(), 2, 'TTL 0 refetches every time');
});

test('invalidateAttributeSchema: forces a refetch before the TTL expires', async () => {
  const { client, fetches } = makeStubbedClient(60_000);
  await client.getAttributeSchema();
  client.invalidateAttributeSchema();
  await client.getAttributeSchema();
  assert.equal(fetches(), 2, 'invalidation drops the cache');
});
