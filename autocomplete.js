'use strict';

/**
 * autocomplete.js
 *
 * Public entry point — orchestrates the full autocomplete pipeline:
 *   1. Validate & sanitise user input
 *   2. Call the prediction API (with retry + timeout via predictionClient)
 *   3. Parse, normalise and rank suggestions (via suggestionEngine)
 *   4. Return a typed result the UI layer can render directly
 */

const { predictIntent, PredictionTimeoutError, PredictionHttpError } = require('./predictionClient');
const { buildSuggestions } = require('./suggestionEngine');

/**
 * Sanitise raw user input before sending to the prediction API.
 * Trims whitespace and enforces a max length to avoid oversized payloads.
 *
 * @param {string} input
 * @param {number} maxLength
 * @returns {string}
 * @throws {RangeError} If input is empty after trimming
 */
function sanitiseInput(input, maxLength = 300) {
  if (typeof input !== 'string') throw new TypeError('User input must be a string');
  const trimmed = input.trim().slice(0, maxLength);
  if (trimmed === '') throw new RangeError('User input must not be empty');
  return trimmed;
}

/**
 * Get autocomplete suggestions for a user's partial or complete input.
 *
 * @param {Object} params
 * @param {string} params.userInput          - Raw text from the user
 * @param {Object} params.apiConfig          - { host, botId, apiKey }
 * @param {Object} [params.engineOptions]    - Passed through to buildSuggestions
 * @param {Object} [params.clientOptions]    - Passed through to predictIntent
 *
 * @returns {Promise<{
 *   type: 'suggestions' | 'not_found' | 'error',
 *   payload: Object
 * }>}
 *
 * The caller never needs to catch — errors are caught here and returned
 * as typed result objects so the UI layer stays simple.
 */
async function getAutocompleteSuggestions({
  userInput,
  apiConfig,
  engineOptions = {},
  clientOptions = {},
}) {
  // --- 1. Validate input ---
  let sanitised;
  try {
    sanitised = sanitiseInput(userInput);
  } catch (err) {
    return {
      type: 'error',
      payload: { message: err.message, code: 'INVALID_INPUT' },
    };
  }

  // --- 2. Call prediction API ---
  let apiResponse;
  try {
    apiResponse = await predictIntent({
      host: apiConfig.host,
      botId: apiConfig.botId,
      apiKey: apiConfig.apiKey,
      text: sanitised,
      opts: clientOptions,
    });
  } catch (err) {
    if (err instanceof PredictionTimeoutError) {
      return {
        type: 'error',
        payload: { message: 'Prediction service timed out. Please try again.', code: 'TIMEOUT' },
      };
    }
    if (err instanceof PredictionHttpError) {
      return {
        type: 'error',
        payload: { message: `Prediction service error (HTTP ${err.status}).`, code: 'HTTP_ERROR', status: err.status },
      };
    }
    return {
      type: 'error',
      payload: { message: 'Unexpected error contacting prediction service.', code: 'UNKNOWN' },
    };
  }

  // --- 3. Build suggestion payload ---
  try {
    return buildSuggestions(apiResponse, engineOptions);
  } catch (err) {
    return {
      type: 'error',
      payload: { message: 'Failed to process prediction response.', code: 'PARSE_ERROR' },
    };
  }
}

module.exports = { getAutocompleteSuggestions, sanitiseInput };
