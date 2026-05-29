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
 *   - which `dynamic_<id>` keys need an explicit name override via
 *     DYNAMIC_FIELD_MAP / the PERSONIO_DYNAMIC_FIELD_MAP env var. Unmapped
 *     fields are auto-named from their label (shown in the OUTPUT KEY column),
 *     so you only override the ones whose label is a poor fit.
 *
 * No attribute IDs are hardcoded here — everything is read live from the API.
 *
 * Usage:
 *   npm run build
 *   node print-attributes.mjs <employeeId>
 *   npm run attributes -- <employeeId>
 */

import 'dotenv/config';
import { PersonioClient, buildAttributeSchema } from './build/api/personio-client.js';

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

async function main() {
  const client = new PersonioClient({ clientId, clientSecret });

  // Request all readable attributes (no `attributes` filter => API returns
  // everything the scope permits for this employee). Build the same schema the
  // list_employee_attributes tool returns, so CLI and tool stay in lockstep.
  const response = await client.getEmployee(employeeId);
  const attrs = response?.data?.attributes;

  if (!attrs) {
    console.error(`No attributes returned for employee ${employeeId}.`);
    process.exit(1);
  }

  const schema = buildAttributeSchema(attrs).sort((a, b) => a.key.localeCompare(b.key));
  console.log(`\nEmployee ${employeeId} — ${schema.length} attribute(s) returned by the API scope:\n`);

  // OUTPUT KEY is the name the field is surfaced under in get_employee /
  // list_employees; SOURCE (map | label | key) shows where that name came from
  // so you can tell which fields rely on the auto-derived label.
  const col = (s, width) => String(s).padEnd(width);
  console.log(`${col('KEY', 28)}${col('TYPE', 10)}${col('OUTPUT KEY', 36)}${col('SOURCE', 9)}LABEL`);
  console.log('-'.repeat(110));

  for (const { key, type, output_key, source, label } of schema) {
    console.log(`${col(key, 28)}${col(type, 10)}${col(output_key, 36)}${col(source, 9)}${label ?? ''}`);
  }

  const labelDerived = schema.filter((a) => a.source === 'label');
  if (labelDerived.length > 0) {
    console.log(
      `\nTip: ${labelDerived.length} dynamic_<id> field(s) are auto-named from their label ` +
        `(SOURCE=label). Override any whose name is a poor fit via PERSONIO_DYNAMIC_FIELD_MAP, e.g.:\n` +
        `  PERSONIO_DYNAMIC_FIELD_MAP='{"${labelDerived[0].key}":"my_field"}'`
    );
  }
}

main().catch((err) => {
  console.error('Failed to fetch attributes:', err instanceof Error ? err.message : err);
  process.exit(1);
});
