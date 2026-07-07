/**
 * Test file for escapeHtml function
 * Tests the XSS prevention utility for enrichment data
 */

import { JSDOM } from 'jsdom';

// Create a DOM environment for testing
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;

// Copy of the escapeHtml function from index.html
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Test cases
const tests = [
  {
    name: "Basic text without special characters",
    input: "Rajesh Kumar",
    expected: "Rajesh Kumar"
  },
  {
    name: "Text with ampersand",
    input: "Tom & Jerry",
    expected: "Tom &amp; Jerry"
  },
  {
    name: "Text with less than and greater than",
    input: "<script>alert('xss')</script>",
    expected: "&lt;script&gt;alert('xss')&lt;/script&gt;"
  },
  {
    name: "Text with quotes",
    input: 'He said "Hello"',
    expected: 'He said "Hello"'
  },
  {
    name: "Mixed special characters",
    input: "<div class=\"test\">Hello & goodbye</div>",
    expected: "&lt;div class=\"test\"&gt;Hello &amp; goodbye&lt;/div&gt;"
  },
  {
    name: "Empty string",
    input: "",
    expected: ""
  },
  {
    name: "Numeric string (12-digit ID)",
    input: "123456789012",
    expected: "123456789012"
  },
  {
    name: "HTML entity injection attempt",
    input: "&lt;script&gt;",
    expected: "&amp;lt;script&amp;gt;"
  },
  {
    name: "NAME field with special chars",
    input: "O'Connor & Associates <admin>",
    expected: "O'Connor &amp; Associates &lt;admin&gt;"
  },
  {
    name: "Null/undefined protection",
    input: null,
    shouldThrow: true
  }
];

// Run tests
console.log('Testing escapeHtml function...\n');
let passCount = 0;
let failCount = 0;

tests.forEach((test, index) => {
  try {
    const result = escapeHtml(test.input);
    const passed = result === test.expected;
    
    if (passed) {
      passCount++;
      console.log(`✓ Test ${index + 1}: ${test.name}`);
    } else {
      failCount++;
      console.log(`✗ Test ${index + 1}: ${test.name}`);
      console.log(`  Input:    ${JSON.stringify(test.input)}`);
      console.log(`  Expected: ${JSON.stringify(test.expected)}`);
      console.log(`  Got:      ${JSON.stringify(result)}`);
    }
  } catch (error) {
    if (test.shouldThrow) {
      passCount++;
      console.log(`✓ Test ${index + 1}: ${test.name} (correctly threw error)`);
    } else {
      failCount++;
      console.log(`✗ Test ${index + 1}: ${test.name} (unexpected error)`);
      console.log(`  Error: ${error.message}`);
    }
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Test Summary: ${passCount}/${tests.length} passed`);
console.log(`${passCount === tests.length ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
console.log('='.repeat(50));

process.exit(failCount > 0 ? 1 : 0);
