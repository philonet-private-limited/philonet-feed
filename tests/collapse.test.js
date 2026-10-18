// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const collapse = require('../src/assembly/collapse');

test('the collapse helpers are exported and count people as a union', () => {
  assert.equal(typeof collapse.resolveDisplay, 'function');
  assert.equal(typeof collapse.resolvePageDisplays, 'function');
  assert.equal(typeof collapse.participantCount, 'function');
});

test('a page of cards with no thread resolves to full cards', () => {
  const out = collapse.resolvePageDisplays([{ type: 'article', payload: { conversation_starters: [{ id: 1, quote: 'q', quote_headline: 'h', content: 'c', members: [] }] } }], 10);
  assert.ok(Array.isArray(out) && out.length === 1);
  assert.equal(out[0], 'full');
});
