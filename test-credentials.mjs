/**
 * Shared Personio credential resolver for the live (test:e2e) test scripts.
 *
 * Resolves credentials from these sources, in order, and reports which was used:
 *   1. PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET environment variables
 *   2. .env in the repo root           (the conventional default credentials)
 *   3. .env.<name> in the repo root    (only when there is no bare .env)
 *   4. ~/.secrets/personio/.env.<name>
 *
 * So a plain .env still works as before; the named .env.<name> files only kick in
 * when there is no .env. All of these are covered by the .env* rule in .gitignore.
 *
 * The credential-set `name` is resolved as: the explicit argument (a test script's
 * first CLI arg) -> the PERSONIO_CREDS_NAME env var -> "recruiting". Use
 * PERSONIO_CREDS_NAME to target a set across the chained group scripts (npm run
 * test:e2e / test:other), where a CLI arg would only reach the last command.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// Resolve the credential-set name: explicit argument, then the PERSONIO_CREDS_NAME
// env var (so it applies across the chained group scripts), then "recruiting".
function effectiveName(name) {
  return name || process.env.PERSONIO_CREDS_NAME || 'recruiting';
}

// Parse a KEY=VALUE .env file into { clientId, clientSecret } (or null). Splits
// on the first '=' only and strips optional surrounding quotes.
function parseEnvFile(file) {
  let clientId, clientSecret;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'PERSONIO_CLIENT_ID') clientId = value;
    if (key === 'PERSONIO_CLIENT_SECRET') clientSecret = value;
  }
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Returns { clientId, clientSecret, source } or null if nothing resolved.
export function resolvePersonioCredentials(name) {
  name = effectiveName(name);

  if (process.env.PERSONIO_CLIENT_ID && process.env.PERSONIO_CLIENT_SECRET) {
    return {
      clientId: process.env.PERSONIO_CLIENT_ID,
      clientSecret: process.env.PERSONIO_CLIENT_SECRET,
      source: 'environment variables',
    };
  }

  // A bare .env (the conventional default) takes priority over the named
  // .env.<name> files, which only kick in when there is no .env.
  const locations = [
    { file: path.join(repoRoot, '.env'), label: 'Git repo root (.env)' },
    { file: path.join(repoRoot, `.env.${name}`), label: 'Git repo root' },
    { file: path.join(os.homedir(), '.secrets', 'personio', `.env.${name}`), label: '.secrets folder' },
  ];
  for (const { file, label } of locations) {
    if (!fs.existsSync(file)) continue;
    const creds = parseEnvFile(file);
    if (creds) return { ...creds, source: `${file} (${label})` };
  }
  return null;
}

// Resolve credentials or exit(1) with a helpful message; logs the chosen source.
export function loadPersonioCredentials(name) {
  name = effectiveName(name);
  const resolved = resolvePersonioCredentials(name);
  if (!resolved) {
    console.error(
      `No Personio credentials found. Provide them via PERSONIO_CLIENT_ID/SECRET, ` +
      `a .env or .env.${name} in the repo root, or ~/.secrets/personio/.env.${name}.`
    );
    process.exit(1);
  }
  console.log(`Using credentials from: ${resolved.source}`);
  return resolved;
}
