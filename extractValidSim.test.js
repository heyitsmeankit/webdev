import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

// Import the extractValidSim function by reading and evaluating server.js
// Since server.js doesn't export the function, we'll extract it for testing
const serverCode = fs.readFileSync('./server.js', 'utf8');
const functionMatch = serverCode.match(/function extractValidSim\(simField\) \{[\s\S]*?\n\}/);
if (!functionMatch) {
  throw new Error('Could not find extractValidSim function in server.js');
}
// Extract and evaluate the function
const extractValidSim = eval(`(${functionMatch[0]})`);

// ── Unit Tests for extractValidSim ────────────────────────────────────────────
// Validates: Requirements 1.1, 1.2

test('extractValidSim: returns null for null input', () => {
  assert.strictEqual(extractValidSim(null), null);
});

test('extractValidSim: returns null for undefined input', () => {
  assert.strictEqual(extractValidSim(undefined), null);
});

test('extractValidSim: returns null for non-string input (number)', () => {
  assert.strictEqual(extractValidSim(1234567890), null);
});

test('extractValidSim: returns null for non-string input (object)', () => {
  assert.strictEqual(extractValidSim({}), null);
});

test('extractValidSim: returns null for non-string input (array)', () => {
  assert.strictEqual(extractValidSim([]), null);
});

test('extractValidSim: extracts 10-digit number from plain string', () => {
  assert.strictEqual(extractValidSim('9876543210'), '9876543210');
});

test('extractValidSim: returns null for 12 digits (country code + 10 digits)', () => {
  // +91-9876543210 becomes 919876543210 (12 digits) which is invalid
  assert.strictEqual(extractValidSim('+91-9876543210'), null);
});

test('extractValidSim: removes spaces and dashes', () => {
  assert.strictEqual(extractValidSim('987 654 3210'), '9876543210');
});

test('extractValidSim: removes parentheses and spaces', () => {
  assert.strictEqual(extractValidSim('(987) 654-3210'), '9876543210');
});

test('extractValidSim: returns null for string with less than 10 digits', () => {
  assert.strictEqual(extractValidSim('987654321'), null);
});

test('extractValidSim: returns null for string with more than 10 digits', () => {
  assert.strictEqual(extractValidSim('98765432101'), null);
});

test('extractValidSim: rejects "N/A" (case-insensitive)', () => {
  assert.strictEqual(extractValidSim('N/A'), null);
});

test('extractValidSim: rejects "n/a" (lowercase)', () => {
  assert.strictEqual(extractValidSim('n/a'), null);
});

test('extractValidSim: rejects "N/a" (mixed case)', () => {
  assert.strictEqual(extractValidSim('N/a'), null);
});

test('extractValidSim: rejects "unknown" (case-insensitive)', () => {
  assert.strictEqual(extractValidSim('unknown'), null);
});

test('extractValidSim: rejects "Unknown" (capitalized)', () => {
  assert.strictEqual(extractValidSim('Unknown'), null);
});

test('extractValidSim: rejects "UNKNOWN" (uppercase)', () => {
  assert.strictEqual(extractValidSim('UNKNOWN'), null);
});

test('extractValidSim: rejects string containing "n/a" with other text', () => {
  assert.strictEqual(extractValidSim('n/a - no sim'), null);
});

test('extractValidSim: rejects string containing "unknown" with numbers', () => {
  assert.strictEqual(extractValidSim('unknown1234567890'), null);
});

test('extractValidSim: returns null for empty string', () => {
  assert.strictEqual(extractValidSim(''), null);
});

test('extractValidSim: returns null for whitespace-only string', () => {
  assert.strictEqual(extractValidSim('   '), null);
});

test('extractValidSim: returns null for international format +91 (12 digits total)', () => {
  // +917894694300 becomes 917894694300 (12 digits) which is invalid
  assert.strictEqual(extractValidSim('+917894694300'), null);
});

test('extractValidSim: extracts exactly 10 digits from formatted number', () => {
  assert.strictEqual(extractValidSim('789-469-4300'), '7894694300');
});

test('extractValidSim: returns null for alphabetic characters only', () => {
  assert.strictEqual(extractValidSim('abcdefghij'), null);
});

test('extractValidSim: handles mixed alphanumeric with 10 digits', () => {
  assert.strictEqual(extractValidSim('abc9876543210def'), '9876543210');
});

test('extractValidSim: edge case - string with "na" (not "n/a") and 10 digits', () => {
  // "na" without "/" should not be rejected
  assert.strictEqual(extractValidSim('na9876543210'), '9876543210');
});

test('extractValidSim: edge case - exactly 10 zeros', () => {
  assert.strictEqual(extractValidSim('0000000000'), '0000000000');
});

test('extractValidSim: edge case - string with special characters and 10 digits', () => {
  assert.strictEqual(extractValidSim('!@#9876543210$%^'), '9876543210');
});
