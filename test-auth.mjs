#!/usr/bin/env node

// Test script to verify authentication with Personio API
// Run this with: node test-auth.mjs

import { PersonioAuth } from './build/auth/personio-auth.js';
import { PersonioClient } from './build/api/personio-client.js';
import { loadPersonioCredentials } from './test-credentials.mjs';
import { looksForbidden } from './test-helpers.mjs';

console.log('🔑 Testing Personio Authentication\n');

const name = process.argv[2];
const { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } = loadPersonioCredentials(name);

console.log('✅ Credentials detected\n');

async function testAuth() {
  // Test V1 Authentication
  console.log('📌 Testing V1 Authentication...');
  try {
    const v1Auth = new PersonioAuth({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      useV2Auth: false, // Force v1 auth
    });

    const v1Token = await v1Auth.getValidToken();
    console.log('✅ V1 authentication successful');
    console.log('   Token type: Bearer');
    console.log('   Token length:', v1Token.length);
    console.log('   First 10 chars:', v1Token.substring(0, 10) + '...');
  } catch (error) {
    console.log('❌ V1 authentication failed:', error.message);
  }

  console.log('\n📌 Testing V2 OAuth Authentication...');
  try {
    const v2Auth = new PersonioAuth({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      useV2Auth: true, // Force v2 auth
    });

    const v2Token = await v2Auth.getValidToken();
    console.log('✅ V2 OAuth authentication successful');
    console.log('   Token type: Bearer');
    console.log('   Token length:', v2Token.length);
    console.log('   First 10 chars:', v2Token.substring(0, 10) + '...');
  } catch (error) {
    console.log('❌ V2 OAuth authentication failed:', error.message);

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.log('\n⚠️  V2 OAuth Issue: Invalid credentials');
      console.log('   • Check if your API credentials are correct');
      console.log('   • Verify credentials have v2 API access enabled');
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      console.log('\n⚠️  V2 OAuth Issue: Access forbidden');
      console.log('   • Your account may not have v2 API access');
      console.log('   • Contact Personio support to enable v2 API');
    }
  }

  console.log('\n📌 Testing Auto-fallback (Default Behavior)...');
  try {
    const autoAuth = new PersonioAuth({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      // useV2Auth not set - will try v2 first, then fall back to v1
    });

    const token = await autoAuth.getValidToken();
    console.log('✅ Auto authentication successful');
    console.log('   Token obtained (v2 or v1 fallback)');
    console.log('   Token length:', token.length);

    // Clear token to test again
    autoAuth.clearToken();
  } catch (error) {
    console.log('❌ Both v1 and v2 authentication failed:', error.message);
  }

  console.log('\n📌 Testing API calls with obtained token...');
  const client = new PersonioClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

  // Each probe needs a specific Personio access right (Zugriffsrecht). A 403 here
  // means auth works but the credential lacks that right — reported as a skip, not
  // a failure (consistent with the smoke test). Other errors are real failures.
  const probes = [
    { label: 'v1 /company/employees', requires: 'Employees (Mitarbeitenden)', call: () => client.getEmployees({ limit: 1 }) },
    { label: 'v2 /attendance-periods', requires: 'Attendances (Anwesenheiten)', call: () => client.getAttendancePeriodsV2({ limit: 1 }) },
  ];

  for (const probe of probes) {
    console.log(`\n   Testing ${probe.label} (requires: ${probe.requires})...`);
    try {
      await probe.call();
      console.log('   ✅ API call successful');
    } catch (error) {
      if (looksForbidden(error.message)) {
        console.log(`   ○ Skipped — credential lacks the "${probe.requires}" access right (403/forbidden)`);
      } else {
        console.log('   ❌ API call failed:', error.message);
      }
    }
  }
}

testAuth().then(() => {
  console.log('\n✅ Authentication test complete!');
  console.log('\n📚 Summary:');
  console.log('   • Authentication (token) succeeded → the credentials are valid.');
  console.log('   • A "○ Skipped" API call means the token is fine but the credential lacks');
  console.log('     that access right (Zugriffsrecht) — enable it in Personio if you need it.');
  console.log('   • A "❌ failed" API call is a real error worth investigating.');
}).catch(error => {
  console.log('\n💥 Test crashed:', error.message);
  process.exit(1);
});