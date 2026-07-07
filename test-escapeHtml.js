/**
 * Unit tests for escapeHtml function
 * Task 8: Add HTML escaping utility
 * Requirements: 6.5
 */

// Mock DOM environment for Node.js testing
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;

// Copy of escapeHtml function from index.html
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Test cases
const testCases = [
  {
    name: 'Plain text (no special characters)',
    input: 'Rajesh Kumar',
    expected: 'Rajesh Kumar'
  },
  {
    name: 'Text with < and > (script tag attempt)',
    input: '<script>alert("xss")</script>',
    expected: '&lt;script&gt;alert("xss")&lt;/script&gt;'
  },
  {
    name: 'Text with quotes',
    input: 'Name with "quotes" and \'apostrophes\'',
    expected: 'Name with "quotes" and \'apostrophes\''
  },
  {
    name: 'Text with ampersand',
    input: 'Company & Associates',
    expected: 'Company &amp; Associates'
  },
  {
    name: 'ID with special characters',
    input: '123456789012<script>',
    expected: '123456789012&lt;script&gt;'
  },
  {
    name: 'Empty string',
    input: '',
    expected: ''
  },
  {
    name: 'XSS attempt with img tag',
    input: '<img src=x onerror=alert(1)>',
    expected: '&lt;img src=x onerror=alert(1)&gt;'
  },
  {
    name: 'Mixed content',
    input: 'Normal text <b>bold</b> & more',
    expected: 'Normal text &lt;b&gt;bold&lt;/b&gt; &amp; more'
  }
];

// Run tests
console.log('Running escapeHtml tests...\n');
let passed = 0;
let failed = 0;

testCases.forEach(test => {
  const result = escapeHtml(test.input);
  const success = result === test.expected;
  
  if (success) {
    console.log(`✓ PASS: ${test.name}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${test.name}`);
    console.log(`  Input:    "${test.input}"`);
    console.log(`  Expected: "${test.expected}"`);
    console.log(`  Got:      "${result}"`);
    failed++;
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
console.log(`${'='.repeat(50)}`);

// Exit with appropriate code
process.exit(failed > 0 ? 1 : 0);
