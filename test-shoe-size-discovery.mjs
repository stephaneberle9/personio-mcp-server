#!/usr/bin/env node

// Test script to discover shoe size attribute in Personio API
// Run this with: node test-shoe-size-discovery.mjs

import { PersonioClient } from './build/api/personio-client.js';
import { loadPersonioCredentials } from './test-credentials.mjs';
import { looksForbidden } from './test-helpers.mjs';

console.log('\n🔍 Discovering Shoe Size Attributes in Personio API\n');

const { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } = loadPersonioCredentials(process.argv[2]);

async function discoverShoeSize() {
  try {
    const client = new PersonioClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    console.log('📌 Step 1: Fetching employee data (first 5 employees)');
    console.log('   This will retrieve ALL attributes from Personio...\n');

    const response = await client.getEmployees({
      limit: 5,
    });

    console.log(`✅ Retrieved ${response.data.length} employee(s)\n`);

    if (response.data.length === 0) {
      console.log('⚠️  No employees found in the system');
      return;
    }

    console.log('📌 Step 2: Analyzing attributes for shoe size fields\n');

    // Possible shoe size field names to check
    const shoeSizeFieldNames = [
      'shoe_size',
      'shoeSize',
      'shoe_size_eu',
      'shoeSizeEu',
      'shoe_size_us',
      'shoeSizeUs',
      'shoe_size_uk',
      'shoeSizeUk',
      'schuhgroesse',  // German
      'schuhgröße',    // German with umlaut
    ];

    let foundShoeSize = false;

    // Check each employee for shoe size attributes
    for (let i = 0; i < response.data.length; i++) {
      const employee = response.data[i];
      const attrs = employee.attributes;

      console.log(`Employee ${i + 1}: ${attrs.first_name?.value} ${attrs.last_name?.value}`);
      console.log(`   ID: ${attrs.id?.value}`);

      // Check for shoe size fields
      const foundFields = [];
      for (const fieldName of shoeSizeFieldNames) {
        if (attrs[fieldName] !== undefined) {
          foundFields.push({
            name: fieldName,
            value: attrs[fieldName].value,
            label: attrs[fieldName].label,
          });
          foundShoeSize = true;
        }
      }

      if (foundFields.length > 0) {
        console.log('   ✅ SHOE SIZE FIELDS FOUND:');
        foundFields.forEach(field => {
          console.log(`      - ${field.name}: ${field.value} (label: "${field.label}")`);
        });
      } else {
        console.log('   ⚠️  No shoe size fields found');
      }
      console.log('');
    }

    console.log('\n📌 Step 3: Listing ALL available attributes\n');
    console.log('Here are all the attribute keys found in the first employee:');
    console.log('(This helps identify if shoe size uses a different name)\n');

    const firstEmployee = response.data[0];
    const allKeys = Object.keys(firstEmployee.attributes);

    // Categorize keys
    const standardKeys = [
      'id', 'email', 'first_name', 'last_name', 'status', 'position',
      'department', 'office', 'hire_date', 'weekly_working_hours'
    ];

    const customKeys = allKeys.filter(key => !standardKeys.includes(key));

    console.log('Standard attributes:');
    standardKeys.forEach(key => {
      if (firstEmployee.attributes[key] !== undefined) {
        console.log(`   ✓ ${key}`);
      }
    });

    console.log('\nCustom/Additional attributes:');
    if (customKeys.length > 0) {
      customKeys.forEach(key => {
        const attr = firstEmployee.attributes[key];
        const value = attr?.value;
        const label = attr?.label || key;
        console.log(`   • ${key} (label: "${label}") = ${JSON.stringify(value)}`);
      });
    } else {
      console.log('   (none found)');
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY\n');

    if (foundShoeSize) {
      console.log('✅ SUCCESS: Shoe size attribute(s) found!');
      console.log('   The field name(s) can be used to extract shoe size data.');
    } else {
      console.log('⚠️  WARNING: No shoe size attributes found');
      console.log('   Possible reasons:');
      console.log('   1. Shoe size is not configured in your Personio instance');
      console.log('   2. The field uses a different name than expected');
      console.log('   3. Check the custom attributes list above for similar fields');
      console.log('\n   💡 TIP: Review the custom attributes above to identify');
      console.log('      the correct field name, then update the code accordingly.');
    }
    console.log('='.repeat(70));

  } catch (error) {
    if (looksForbidden(error.message)) {
      console.log('○ Skipped — credential lacks the "Employees (Mitarbeitenden)" access right (403/forbidden)');
      return;
    }
    console.log('❌ Discovery failed:', error.message);
    if (error.stack) {
      console.log('\nStack trace:', error.stack);
    }
  }
}

discoverShoeSize().then(() => {
  console.log('\n🎉 Shoe size discovery complete!');
}).catch(error => {
  console.log('\n💥 Discovery crashed:', error.message);
  process.exit(1);
});
