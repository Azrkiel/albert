'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../reference/logic.js');

test('search trims input, ignores case, and searches titles and courses', () => {
  assert.equal(L.filterRows(L.rows, ' ALGEBRA I ').length, 4);
  assert.deepEqual(L.filterRows(L.rows, 'limits').map(x => x.id), [4]);
});
test('status combines with the search query', () => {
  assert.deepEqual(L.filterRows(L.rows, 'Algebra I', 'Needs material').map(x => x.id), [3]);
});
test('sort produces both orders without mutating original data', () => {
  const original = L.rows.map(x => x.id);
  const asc = L.filterRows(L.rows).map(x => x.title);
  const desc = L.filterRows(L.rows, '', 'All', 'desc').map(x => x.title);
  assert.deepEqual(desc, asc.slice().reverse());
  assert.deepEqual(L.rows.map(x => x.id), original);
});
test('empty search results paginate coherently', () => {
  const result = L.paginate(L.filterRows(L.rows, 'unmatchable'), 9);
  assert.deepEqual(result, { rows: [], page: 1, pages: 1, total: 0 });
});
test('pagination clamps page after a restrictive filter', () => {
  const result = L.paginate(L.filterRows(L.rows, '', 'Needs material'), 2);
  assert.equal(result.page, 1);
  assert.equal(result.rows.length, 2);
});
test('invalid pagination parameters stay within bounds', () => {
  assert.equal(L.paginate(L.rows, -8, 0).page, 1);
  assert.equal(L.paginate(L.rows, NaN).page, 1);
  assert.equal(L.paginate(L.rows, 99).page, 2);
});
test('form validation reports all relevant missing details', () => {
  assert.deepEqual(Object.keys(L.validateCourse({})).sort(), ['email', 'method', 'name']);
});
test('valid form values produce no errors', () => {
  assert.deepEqual(L.validateCourse({ name: ' Algebra I ', email: ' learner@example.com ', method: 'upload' }), {});
});
test('invalid email and whitespace-only name have specific errors', () => {
  const result = L.validateCourse({ name: '  ', email: 'missing-domain', method: 'upload' });
  assert.ok(result.email);
  assert.ok(result.name);
  assert.equal(result.method, undefined);
});
test('file validation accepts supported uppercase extensions and exact size boundary', () => {
  assert.equal(L.validateFile({ name: 'Worksheet.PDF', size: 10 * 1024 * 1024 }), '');
  assert.equal(L.validateFile({ name: 'notes.jpeg', size: 100 }), '');
});
test('file validation rejects missing, empty, oversized, and unsupported files', () => {
  assert.notEqual(L.validateFile(null), '');
  assert.notEqual(L.validateFile({ name: 'notes.pdf', size: 0 }), '');
  assert.notEqual(L.validateFile({ name: 'notes.pdf', size: 10 * 1024 * 1024 + 1 }), '');
  assert.notEqual(L.validateFile({ name: 'notes.exe', size: 400 }), '');
});
