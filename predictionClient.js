'use strict';

/**
 * predictionClient.js
 *
 * Thin, production-hardened HTTP client for the intent prediction API.
 *
 * Responsibilities:
 *   - Build and send the prediction request
 *   - Enforce a configurable timeout (abort long-running requests)
 *   - Retry on transient failures with exponential back-off
 *   - Surface typed errors so the caller can handle each failure mode
 */

const DEFAULT_CLIENT_OPTIONS = {
  timeoutMs: 3000,       // abort request after 3 s
  maxRetries: 2,         // retry up to 2 times on transient errors
  backoffBaseMs: 200,    // initial back-off delay; doubles each retry
  language: 'en',
};

/** Errors the caller can instanceof-check against */
class PredictionTimeoutError extends Error {
  constructor(url) {
    super(`Prediction API timed out: ${url}`);
    this.name = 'PredictionTimeoutError';
  }
}

class PredictionHttpError extends Error {
  constructor(status, body) {
    super(`Prediction API returned HTTP ${status}`);
    this.name = 'PredictionHttpError';
    this.status = status;
    this.body = body;
  }
}

class PredictionNetworkError extends Error {
  constructor(cause) {
    super(`Network error reaching prediction API: ${cause.message}`);
    this.name = 'PredictionNetworkError';
    this.cause = cause;
  }
}

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determine whether a failed attempt is worth retrying.
 * Retries on network errors and 429 / 5xx HTTP responses.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (err instanceof PredictionNetworkError) return true;
  if (err instanceof PredictionHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

/**
 * Fire a single prediction request (no retry logic).
 *
 * @param {string} url
 * @param {string} apiKey
 * @param {string} text       - The user's message text
 * @param {Object} opts
 * @returns {Promise<Object>} Parsed JSON response body
 */
async function fetchOnce(url, apiKey, text, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ language: opts.language, text }),
    });

    const rawBody = await response.text();

    if (!response.ok) {
      throw new PredictionHttpError(response.status, rawBody);
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw new PredictionHttpError(response.status, `Non-JSON body: ${rawBody}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new PredictionTimeoutError(url);
    }
    if (err instanceof PredictionHttpError || err instanceof PredictionTimeoutError) {
      throw err;
    }
    throw new PredictionNetworkError(err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the intent prediction API with automatic retry on transient failures.
 *
 * @param {Object} params
 * @param {string} params.host    - Base URL, e.g. "https://api.example.com"
 * @param {string} params.botId   - Bot identifier
 * @param {string} params.apiKey  - API authentication key
 * @param {string} params.text    - User's message
 * @param {Object} [params.opts]  - Optional overrides for DEFAULT_CLIENT_OPTIONS
 * @returns {Promise<Object>} Raw API response body
 */
async function predictIntent({ host, botId, apiKey, text, opts = {} }) {
  if (!host || !botId || !apiKey) {
    throw new TypeError('predictIntent requires host, botId, and apiKey');
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('predictIntent requires a non-empty text string');
  }

  const config = { ...DEFAULT_CLIENT_OPTIONS, ...opts };
  const url = `${host}/api/ai/prediction?bot=${encodeURIComponent(botId)}`;

  let lastError;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.backoffBaseMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    try {
      return await fetchOnce(url, apiKey, text, config);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break; // don't retry on 4xx or timeout
    }
  }

  throw lastError;
}

module.exports = {
  predictIntent,
  PredictionTimeoutError,
  PredictionHttpError,
  PredictionNetworkError,
};
