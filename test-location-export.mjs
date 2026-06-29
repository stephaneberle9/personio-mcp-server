#!/usr/bin/env node

// Test script to verify location export functionality
// Run this with: node test-location-export.mjs

import { PersonioClient } from './build/api/personio-client.js';
import { EmployeeHandlers } from './build/handlers/employee-handlers.js';
import { loadPersonioCredentials } from './test-credentials.mjs';
import { looksForbidden } from './test-helpers.mjs';

console.log('\n🧪 Testing Location Export Functionality\n');

const { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } = loadPersonioCredentials(process.argv[2]);

async function testLocationExport() {
  try {
    const client = new PersonioClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const handlers = new EmployeeHandlers(client);

    console.log('📌 Test 1: List employees with location (JSON format)');
    console.log('   Fetching first 5 employees...\n');

    const jsonResult = await handlers.handleListEmployees({
      limit: 5,
    });

    const jsonData = JSON.parse(jsonResult.content[0].text);
    console.log('   ✅ JSON Result:');
    console.log(`   Total employees: ${jsonData.total}`);
    console.log(`   First employee office: ${jsonData.employees[0]?.office || 'N/A'}`);
    console.log('');

    // Display all employees with their offices
    console.log('   Employees with locations:');
    jsonData.employees.forEach((emp, idx) => {
      console.log(`   ${idx + 1}. ${emp.name} - Office: ${emp.office || 'N/A'}`);
    });
    console.log('');

    console.log('📌 Test 2: Filter employees by office');

    // Get the office name from the first employee to test filtering
    const testOffice = jsonData.employees.find(e => e.office)?.office;

    if (testOffice) {
      console.log(`   Filtering by office: "${testOffice}"\n`);

      const filteredResult = await handlers.handleListEmployees({
        limit: 10,
        office: testOffice,
      });

      const filteredData = JSON.parse(filteredResult.content[0].text);
      console.log('   ✅ Filtered Result:');
      console.log(`   Employees in "${testOffice}": ${filteredData.total}`);
      filteredData.employees.forEach((emp, idx) => {
        console.log(`   ${idx + 1}. ${emp.name} - Office: ${emp.office}`);
      });
      console.log('');
    } else {
      console.log('   ⚠️  No employees with office data found, skipping filter test\n');
    }

    console.log('📌 Test 3: Export to CSV format');
    console.log('   Fetching first 5 employees as CSV...\n');

    const csvResult = await handlers.handleListEmployees({
      limit: 5,
      format: 'csv',
    });

    console.log('   ✅ CSV Result:');
    console.log('   ' + csvResult.content[0].text.split('\n').slice(0, 10).join('\n   '));
    console.log('   ...');
    console.log('');

    console.log('📌 Test 4: Export filtered employees to CSV');

    if (testOffice) {
      console.log(`   Exporting employees from "${testOffice}" as CSV...\n`);

      const csvFilteredResult = await handlers.handleListEmployees({
        limit: 10,
        office: testOffice,
        format: 'csv',
      });

      console.log('   ✅ CSV Filtered Result (first 8 lines):');
      console.log('   ' + csvFilteredResult.content[0].text.split('\n').slice(0, 8).join('\n   '));
      console.log('');
    }

    console.log('✅ All tests passed!');

  } catch (error) {
    if (looksForbidden(error.message)) {
      console.log('○ Skipped — credential lacks the "Employees (Mitarbeitenden)" access right (403/forbidden)');
      return;
    }
    console.log('❌ Test failed:', error.message);
    if (error.stack) {
      console.log('\nStack trace:', error.stack);
    }
  }
}

testLocationExport().then(() => {
  console.log('\n🎉 Location export testing complete!');
}).catch(error => {
  console.log('\n💥 Test crashed:', error.message);
  process.exit(1);
});
