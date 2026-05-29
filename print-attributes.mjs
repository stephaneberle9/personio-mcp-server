#!/usr/bin/env node
/**
 * Attribute discovery helper.
 *
 * For a given employee ID, prints EVERY attribute key the Personio API returns
 * for that employee, together with its human-readable label and the JS type of
 * its value. This is the generic way to find out which attribute keys (and
 * which cryptic `dynamic_<id>` custom-field keys) a specific Personio tenant
 * actually exposes under the current API credential's readable-attributes
 * scope.
 *
 * Use the output to decide:
 *   - which keys to request via the `attributes` parameter of
 *     get_employee / list_employees, and
 *   - which `dynamic_<id>` keys to give a readable name via DYNAMIC_FIELD_MAP /
 *     the PERSONIO_DYNAMIC_FIELD_MAP env var.
 *
 * No attribute IDs are hardcoded here — everything is read live from the API.
 *
 * Usage:
 *   npm run build
 *   node print-attributes.mjs <employeeId>
 *   npm run attributes -- <employeeId>
 */

import 'dotenv/config';
import { PersonioClient, DYNAMIC_FIELD_MAP } from './build/api/personio-client.js';

const employeeId = Number(process.argv[2]);

if (!Number.isInteger(employeeId) || employeeId <= 0) {
  console.error('Usage: node print-attributes.mjs <employeeId>');
  console.error('Example: node print-attributes.mjs 12345');
  process.exit(1);
}

const clientId = process.env.PERSONIO_CLIENT_ID;
const clientSecret = process.env.PERSONIO_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET (set them in .env).');
  process.exit(1);
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

async function main() {
  const client = new PersonioClient({ clientId, clientSecret });

  // Request all readable attributes (no `attributes` filter => API returns
  // everything the scope permits for this employee).
  const response = await client.getEmployee(employeeId);
  const attrs = response?.data?.attributes;

  if (!attrs) {
    console.error(`No attributes returned for employee ${employeeId}.`);
    process.exit(1);
  }

  const keys = Object.keys(attrs).sort();
  console.log(`\nEmployee ${employeeId} — ${keys.length} attribute(s) returned by the API scope:\n`);

  const col = (s, width) => String(s).padEnd(width);
  console.log(`${col('KEY', 28)}${col('TYPE', 10)}${col('MAPPED NAME', 18)}LABEL`);
  console.log('-'.repeat(96));

  for (const key of keys) {
    const attr = attrs[key] ?? {};
    const label = attr.label ?? '';
    const type = describeValue(attr.value);
    const mapped = DYNAMIC_FIELD_MAP[key] ?? '';
    console.log(`${col(key, 28)}${col(type, 10)}${col(mapped, 18)}${label}`);
  }

  const dynamicKeys = keys.filter((k) => k.startsWith('dynamic_'));
  if (dynamicKeys.length > 0) {
    console.log(
      `\nTip: ${dynamicKeys.length} dynamic_<id> custom field(s) found. ` +
        `Give any of them a readable name by adding it to PERSONIO_DYNAMIC_FIELD_MAP, e.g.:\n` +
        `  PERSONIO_DYNAMIC_FIELD_MAP='{"${dynamicKeys[0]}":"my_field"}'`
    );
  }
}

main().catch((err) => {
  console.error('Failed to fetch attributes:', err instanceof Error ? err.message : err);
  process.exit(1);
});
