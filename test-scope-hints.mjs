/**
 * Tests for the scope-hint helpers that turn a Personio 403 into an actionable
 * message naming the exact credential access right ("Zugriffsrechte") to enable.
 * Offline, no credentials.
 *
 * Usage: npm run build && node --test test-scope-hints.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_AREAS,
  isForbiddenError,
  accessRightHint,
  accessDeniedResult,
} from './build/utils/scope-hints.js';

test('isForbiddenError: detects raw axios 403 (response.status)', () => {
  assert.equal(isForbiddenError({ response: { status: 403 } }), true);
});

test('isForbiddenError: detects wrapped Error messages', () => {
  assert.equal(isForbiddenError(new Error('Personio API error: Request failed with status code 403')), true);
  assert.equal(isForbiddenError(new Error('Recruiting API access denied. ...')), true);
  assert.equal(isForbiddenError(new Error('403 Forbidden')), true);
});

test('isForbiddenError: false for non-403 errors', () => {
  assert.equal(isForbiddenError({ response: { status: 404 } }), false);
  assert.equal(isForbiddenError(new Error('Request failed with status code 500')), false);
  assert.equal(isForbiddenError(undefined), false);
});

test('accessRightHint: single area names the English + German label and Read', () => {
  const hint = accessRightHint(['documents']);
  assert.match(hint, /"Documents" \(Dokumenten\)/);
  assert.match(hint, /Read \(Lesen\)/);
  // Single-area hint is unambiguous — no "at least one" wording.
  assert.doesNotMatch(hint, /at least one/);
});

test('accessRightHint: write access uses the Bearbeiten verb', () => {
  const hint = accessRightHint(['documents'], 'write');
  assert.match(hint, /Write \(Bearbeiten\)/);
});

test('accessRightHint: multiple areas list all and flag ambiguity', () => {
  const hint = accessRightHint(['attendances', 'absences', 'employees']);
  assert.match(hint, /Attendances/);
  assert.match(hint, /Absences/);
  assert.match(hint, /Employees/);
  assert.match(hint, /at least one/);
});

test('accessDeniedResult: returns an isError result with a parseable hint', () => {
  const result = accessDeniedResult('get employee documents', new Error('boom 403'), ['documents']);
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.error, 'Failed to get employee documents');
  assert.equal(payload.message, 'boom 403');
  assert.match(payload.hint, /"Documents" \(Dokumenten\)/);
});

test('ACCESS_AREAS: every area exposes English and German labels', () => {
  for (const [key, labels] of Object.entries(ACCESS_AREAS)) {
    assert.ok(labels.en, `${key} missing en label`);
    assert.ok(labels.de, `${key} missing de label`);
  }
});
