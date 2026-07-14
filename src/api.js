'use strict';

// Thin wrapper around the BrowserCoin helper server HTTP API.
// See docs/developers.md in the BrowserCoin repo for the full spec.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, baseUrl, maxRetries = 6) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      throw describeFetchError(baseUrl, err);
    }
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : Math.min(1000 * 2 ** attempt, 15000);
      lastErr = new Error('rate limited (429)');
      if (attempt < maxRetries) {
        await sleep(retryAfterMs);
        continue;
      }
      throw new Error(
        `The helper server is rate-limiting requests (429). ` +
        `Try again in a moment, or switch helper server ` +
        `in settings (e.g. https://api2.browsercoin.org).`
      );
    }
    return res;
  }
  throw lastErr;
}

function describeFetchError(baseUrl, err) {
  const cause = err && err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '';
  return new Error(
    `Could not reach the helper server at ${baseUrl}${cause}. ` +
    `Check that it's running (npm run server:api) and that the URL is correct ` +
    `(try 127.0.0.1 instead of localhost if the problem persists).`
  );
}

async function getTip(baseUrl) {
  const res = await fetchWithRetry(`${baseUrl}/tip`, undefined, baseUrl);
  if (!res.ok) throw new Error(`GET /tip failed (${res.status})`);
  return res.json(); // { height, tipHash }
}

async function getBlocks(baseUrl, fromHeight, max = 200) {
  const url = `${baseUrl}/blocks?fromHeight=${fromHeight}&max=${max}`;
  const res = await fetchWithRetry(url, undefined, baseUrl);
  if (!res.ok) throw new Error(`GET /blocks failed (${res.status})`);
  const data = await res.json();
  return data.blocks || []; // array of hex strings
}

async function submitTx(baseUrl, txHex) {
  const res = await fetchWithRetry(`${baseUrl}/txs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txs: [txHex] })
  }, baseUrl);
  if (!res.ok) throw new Error(`POST /txs failed (${res.status})`);
  return res.json(); // { admitted, errors }
}

async function getStats(baseUrl) {
  const res = await fetch(`${baseUrl}/stats`);
  if (!res.ok) throw new Error(`GET /stats failed (${res.status})`);
  return res.json();
}

module.exports = { getTip, getBlocks, submitTx, getStats };
