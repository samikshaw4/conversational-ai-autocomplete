'use strict';

/**
 * SuggestionEngine
 *
 * Parses a raw prediction API response, normalises intent names,
 * enforces a configurable top-K cap, and returns a ready-to-render
 * quick-reply payload.
 *
 * Design mirrors the classic "Search Autocomplete System":
 *   Retrieval  → handled upstream by the ML prediction API
 *   Ranking    → preserved from API response order (highest-confidence first)
 *   Top-K      → enforced here before returning to the caller
 *   Presentation → normalised, human-readable titles built here
 */

const DEFAULT_OPTIONS = {
  maxSuggestions: 5,
  fallbackTitle: "Hmm, I'm a little confused. Are these close to what you meant?",
  fallbackOption: { title: 'Not Found', text: 'Not Found' },
  notFoundMessage: "Sorry, I was unable to understand your query 🙁",
};

/**
 * Normalise a raw intent name from the ML model into a human-readable string.
 *
 * Rules applied (in order):
 *   1. Truncate compound snake_case names — take only the first segment.
 *      e.g. "order_status_enquiry" → "order"
 *   2. Replace hyphens with spaces.
 *      e.g. "track-order" → "track order"
 *   3. Title-case the result.
 *      e.g. "track order" → "Track Order"
 *
 * @param {string} raw - Raw intent name from API response.
 * @returns {string} Human-readable label.
 * @throws {TypeError} If raw is not a non-empty string.
 */
function normaliseIntentName(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new TypeError(`normaliseIntentName expects a non-empty string, got: ${JSON.stringify(raw)}`);
  }

  let name = raw.trim();

  // Rule 1 — strip compound tail (snake_case)
  if (name.includes('_')) {
    name = name.split('_')[0];
  }

  // Rule 2 — hyphens → spaces
  name = name.replace(/-/g, ' ');

  // Rule 3 — title-case
  name = name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return name;
}

/**
 * Extract the intent list from an API response object.
 *
 * The prediction API can return results under two different keys
 * depending on whether similar intents or direct intents were matched.
 * This function abstracts that variance.
 *
 * @param {Object} apiResponse - Raw API response body.
 * @returns {Array|null} Array of intent objects, or null if none found.
 * @throws {TypeError} If apiResponse is not a plain object.
 */
function extractIntents(apiResponse) {
  if (!apiResponse || typeof apiResponse !== 'object') {
    throw new TypeError(`extractIntents expects an object, got: ${typeof apiResponse}`);
  }

  const data = apiResponse.data || apiResponse;

  if (Array.isArray(data.similar_intents) && data.similar_intents.length > 0) {
    return data.similar_intents;
  }

  if (Array.isArray(data.intents) && data.intents.length > 0) {
    return data.intents;
  }

  return null;
}

/**
 * Build the suggestion payload from a raw prediction API response.
 *
 * @param {Object} apiResponse  - Raw JSON body from the prediction API.
 * @param {Object} [opts]       - Optional overrides for DEFAULT_OPTIONS.
 * @returns {{ type: 'suggestions'|'not_found', payload: Object }}
 *
 * On success:
 *   { type: 'suggestions', payload: { title: string, options: Array<{title, text}> } }
 *
 * On no match:
 *   { type: 'not_found', payload: { message: string } }
 */
function buildSuggestions(apiResponse, opts = {}) {
  const config = { ...DEFAULT_OPTIONS, ...opts };

  let intents;
  try {
    intents = extractIntents(apiResponse);
  } catch (err) {
    throw new Error(`Failed to extract intents from API response: ${err.message}`);
  }

  if (!intents) {
    return {
      type: 'not_found',
      payload: { message: config.notFoundMessage },
    };
  }

  const suggestions = [];
  const seen = new Set(); // deduplicate after normalisation

  for (const intent of intents) {
    if (suggestions.length >= config.maxSuggestions) break;

    // Intent objects can carry the name at different paths
    const rawName =
      (intent.name)                  ||
      (intent.data && intent.data.intents) ||
      null;

    if (!rawName) continue; // skip malformed entries silently

    let label;
    try {
      label = normaliseIntentName(rawName);
    } catch {
      continue; // skip un-normalisable entries rather than crashing
    }

    if (seen.has(label)) continue; // skip duplicates post-normalisation
    seen.add(label);

    suggestions.push({ title: label, text: label });
  }

  if (suggestions.length === 0) {
    return {
      type: 'not_found',
      payload: { message: config.notFoundMessage },
    };
  }

  // Always append the escape-hatch fallback option
  suggestions.push(config.fallbackOption);

  return {
    type: 'suggestions',
    payload: {
      title: config.fallbackTitle,
      options: suggestions,
    },
  };
}

module.exports = { buildSuggestions, normaliseIntentName, extractIntents };
