'use strict';

/**
 * tests/suggestionEngine.test.js
 *
 * Unit tests for the core suggestion engine.
 * Uses Node's built-in test runner (node:test) — no extra dependencies.
 *
 * Run: node --test tests/suggestionEngine.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  normaliseIntentName,
  extractIntents,
  buildSuggestions,
} = require('../src/suggestionEngine');

// ---------------------------------------------------------------------------
// normaliseIntentName
// ---------------------------------------------------------------------------

describe('normaliseIntentName', () => {
  test('converts snake_case — keeps only first segment', () => {
    assert.equal(normaliseIntentName('order_status_enquiry'), 'Order');
  });

  test('replaces hyphens with spaces', () => {
    assert.equal(normaliseIntentName('track-order'), 'Track Order');
  });

  test('title-cases each word', () => {
    assert.equal(normaliseIntentName('billing enquiry'), 'Billing Enquiry');
  });

  test('handles a plain single word', () => {
    assert.equal(normaliseIntentName('refund'), 'Refund');
  });

  test('handles mixed snake and hyphen', () => {
    // snake_case truncates first, then hyphens inside that segment are resolved
    assert.equal(normaliseIntentName('track-order_details'), 'Track Order');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(normaliseIntentName('  cancel  '), 'Cancel');
  });

  test('throws TypeError on empty string', () => {
    assert.throws(() => normaliseIntentName(''), { name: 'TypeError' });
  });

  test('throws TypeError on non-string input', () => {
    assert.throws(() => normaliseIntentName(null), { name: 'TypeError' });
    assert.throws(() => normaliseIntentName(42), { name: 'TypeError' });
  });
});

// ---------------------------------------------------------------------------
// extractIntents
// ---------------------------------------------------------------------------

describe('extractIntents', () => {
  test('prefers similar_intents when present and non-empty', () => {
    const resp = {
      data: {
        similar_intents: [{ name: 'track-order' }],
        intents: [{ name: 'cancel-order' }],
      },
    };
    const result = extractIntents(resp);
    assert.equal(result[0].name, 'track-order');
  });

  test('falls back to intents when similar_intents is empty', () => {
    const resp = {
      data: {
        similar_intents: [],
        intents: [{ name: 'cancel-order' }],
      },
    };
    const result = extractIntents(resp);
    assert.equal(result[0].name, 'cancel-order');
  });

  test('returns null when both arrays are empty', () => {
    const resp = { data: { similar_intents: [], intents: [] } };
    assert.equal(extractIntents(resp), null);
  });

  test('returns null when data has no intent keys', () => {
    assert.equal(extractIntents({ data: {} }), null);
  });

  test('works when response has no wrapping data key', () => {
    const resp = { intents: [{ name: 'billing-enquiry' }] };
    const result = extractIntents(resp);
    assert.equal(result[0].name, 'billing-enquiry');
  });

  test('throws TypeError for non-object input', () => {
    assert.throws(() => extractIntents(null), { name: 'TypeError' });
    assert.throws(() => extractIntents('string'), { name: 'TypeError' });
  });
});

// ---------------------------------------------------------------------------
// buildSuggestions
// ---------------------------------------------------------------------------

describe('buildSuggestions', () => {
  const mockResponse = {
    data: {
      similar_intents: [
        { name: 'track-order' },
        { name: 'cancel-order' },
        { name: 'billing-enquiry' },
      ],
    },
  };

  test('returns type "suggestions" for a valid response', () => {
    const result = buildSuggestions(mockResponse);
    assert.equal(result.type, 'suggestions');
  });

  test('payload has title and options array', () => {
    const { payload } = buildSuggestions(mockResponse);
    assert.ok(typeof payload.title === 'string');
    assert.ok(Array.isArray(payload.options));
  });

  test('each option has title and text fields', () => {
    const { payload } = buildSuggestions(mockResponse);
    for (const opt of payload.options) {
      assert.ok(typeof opt.title === 'string');
      assert.ok(typeof opt.text === 'string');
    }
  });

  test('always appends "Not Found" fallback option', () => {
    const { payload } = buildSuggestions(mockResponse);
    const last = payload.options[payload.options.length - 1];
    assert.equal(last.title, 'Not Found');
  });

  test('respects maxSuggestions cap (not counting fallback)', () => {
    const bigResponse = {
      data: {
        similar_intents: Array.from({ length: 10 }, (_, i) => ({ name: `intent-${i}` })),
      },
    };
    const { payload } = buildSuggestions(bigResponse, { maxSuggestions: 3 });
    // 3 real suggestions + 1 fallback
    assert.equal(payload.options.length, 4);
  });

  test('deduplicates suggestions that normalise to the same label', () => {
    const dupResponse = {
      data: {
        similar_intents: [
          { name: 'order_status' },
          { name: 'order_history' },  // both normalise to "Order" → second is skipped
          { name: 'cancel-order' },
        ],
      },
    };
    const { payload } = buildSuggestions(dupResponse);
    const titles = payload.options.map(o => o.title).filter(t => t !== 'Not Found');
    const unique = new Set(titles);
    assert.equal(titles.length, unique.size);
  });

  test('returns type "not_found" for empty intents', () => {
    const emptyResponse = { data: { similar_intents: [], intents: [] } };
    const result = buildSuggestions(emptyResponse);
    assert.equal(result.type, 'not_found');
    assert.ok(typeof result.payload.message === 'string');
  });

  test('returns type "not_found" for null API data', () => {
    const nullResponse = { data: {} };
    const result = buildSuggestions(nullResponse);
    assert.equal(result.type, 'not_found');
  });

  test('custom notFoundMessage is used in not_found result', () => {
    const result = buildSuggestions({ data: {} }, { notFoundMessage: 'Custom message' });
    assert.equal(result.payload.message, 'Custom message');
  });

  test('skips intent entries with no name field (malformed)', () => {
    const messyResponse = {
      data: {
        similar_intents: [
          { name: 'track-order' },
          { no_name_here: true },         // malformed — should be skipped
          { name: 'billing-enquiry' },
        ],
      },
    };
    const { payload } = buildSuggestions(messyResponse);
    const realOpts = payload.options.filter(o => o.title !== 'Not Found');
    assert.equal(realOpts.length, 2);
  });

  test('accepts alternate name path: intent.data.intents', () => {
    const altResponse = {
      data: {
        intents: [
          { data: { intents: 'return-product' } },
        ],
      },
    };
    const { payload } = buildSuggestions(altResponse);
    assert.equal(payload.options[0].title, 'Return Product');
  });
});
