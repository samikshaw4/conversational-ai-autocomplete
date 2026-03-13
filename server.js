'use strict';

/**
 * mock-server/server.js
 *
 * Lightweight mock of the intent prediction API.
 * Uses Node's built-in `http` module — zero external dependencies.
 *
 * Endpoints:
 *   POST /api/ai/prediction?bot=<botId>
 *     Body: { language: string, text: string }
 *     Returns a ranked list of matched intents based on keyword matching.
 *
 * Run: node mock-server/server.js
 * Default port: 3001 (override with PORT env var)
 */

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Intent corpus — simulates what an ML model would have indexed
// ---------------------------------------------------------------------------
const INTENT_CORPUS = [
  { name: 'track-order',        keywords: ['track', 'order', 'where', 'status', 'shipment', 'delivery'] },
  { name: 'cancel-order',       keywords: ['cancel', 'order', 'stop', 'abort', 'undo'] },
  { name: 'return-product',     keywords: ['return', 'refund', 'give back', 'exchange', 'replace'] },
  { name: 'billing-enquiry',    keywords: ['bill', 'invoice', 'charge', 'payment', 'receipt', 'cost'] },
  { name: 'account-settings',   keywords: ['account', 'settings', 'profile', 'update', 'change', 'password'] },
  { name: 'contact-support',    keywords: ['help', 'support', 'agent', 'human', 'talk', 'call', 'contact'] },
  { name: 'product-info',       keywords: ['product', 'detail', 'spec', 'description', 'feature', 'info'] },
  { name: 'shipping-policy',    keywords: ['shipping', 'delivery', 'time', 'days', 'arrive', 'cost', 'fee'] },
  { name: 'password-reset',     keywords: ['password', 'reset', 'forgot', 'login', 'sign', 'access'] },
  { name: 'address-update',     keywords: ['address', 'change', 'update', 'location', 'move', 'delivery'] },
];

/**
 * Score an intent against a user query.
 * Returns the count of matching keywords (simple overlap scoring).
 *
 * @param {Object} intent
 * @param {string} query  - lowercased user text
 * @returns {number}
 */
function scoreIntent(intent, query) {
  return intent.keywords.filter(kw => query.includes(kw)).length;
}

/**
 * Find the top-N intents matching a query.
 *
 * @param {string} text
 * @param {number} [topN=5]
 * @returns {{ similar_intents: Array }|{ intents: Array }|null}
 */
function predict(text, topN = 5) {
  const query = text.toLowerCase();

  const scored = INTENT_CORPUS
    .map(intent => ({ ...intent, score: scoreIntent(intent, query) }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (scored.length === 0) return null;

  // Alternate between response shapes to exercise both code paths
  const useSimilarIntents = Math.random() > 0.3;
  const key = useSimilarIntents ? 'similar_intents' : 'intents';

  return {
    [key]: scored.map(({ name, score }) => ({ name, confidence: score })),
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const base = `http://${req.headers.host}`;
  const { pathname, searchParams } = new URL(req.url, base);

  // Auth check — require X-Api-Key header
  if (!req.headers['x-api-key']) {
    return send(res, 401, { error: 'Missing X-Api-Key header' });
  }

  // Route: POST /api/ai/prediction
  if (req.method === 'POST' && pathname === '/api/ai/prediction') {
    const botId = searchParams.get('bot');
    if (!botId) return send(res, 400, { error: 'Missing ?bot= query param' });

    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' });
    }

    if (!body.text || typeof body.text !== 'string') {
      return send(res, 400, { error: '"text" field is required in request body' });
    }

    const data = predict(body.text);

    if (!data) {
      return send(res, 200, { data: { intents: [] } });
    }

    // Simulate slight network latency (50–150 ms)
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    return send(res, 200, { data });
  }

  // Health check
  if (req.method === 'GET' && pathname === '/health') {
    return send(res, 200, { status: 'ok', intents_in_corpus: INTENT_CORPUS.length });
  }

  send(res, 404, { error: `No route for ${req.method} ${pathname}` });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handler(req, res).catch(err => {
    console.error('[mock-server] Unhandled error:', err);
    send(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`\n🤖  Mock Prediction API running at http://localhost:${PORT}`);
  console.log(`    POST  /api/ai/prediction?bot=<id>  →  intent suggestions`);
  console.log(`    GET   /health                      →  health check\n`);
});

module.exports = server; // exported for testing
