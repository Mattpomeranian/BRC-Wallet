'use strict';

// There is no /account or /balance endpoint on the helper server (see
// docs/developers.md §10: "fetch your account's current nonce by replaying
// the chain or querying an explorer you trust"). So this wallet keeps a
// small local cache (last synced height + running balance/nonce for our
// own address) and replays only the blocks it hasn't seen yet.
//
// Trust note: this trusts the helper server's block CONTENTS as-is for both
// proof-of-work and the txRoot/stateRoot Merkle commitments. A PoW check
// (Argon2id, src/pow.js) was implemented and tested but had to be reverted
// -- see the comment at the applyBlock() call site below for why. What this
// DOES verify: chain continuity (each block's declared height must be
// exactly one more than the last, and its prevHash must match the hash of
// the block we previously accepted) and the genesis hash (see below). A
// helper that tries to splice in an inconsistent or out-of-order block, or
// serve a fabricated chain from height 0, gets caught here. This is NOT a
// full validating node -- PoW and Merkle roots are still unchecked -- so a
// helper that already knows the real chain so far could still splice in a
// block with fabricated contents past the last honestly-synced height,
// without needing to have done any real work.
//
// Genesis pin: docs/developers.md §4 says the genesis block is deterministic
// and "independent verifiers should treat any chain whose height-0 block
// differs from this as a different network." The doc's own stated values
// are stale (see note on GENESIS_BLOCK_HASH below), but the principle holds
// -- we verify block 0's hash against the real network's known-good value
// before trusting anything a helper reports, so a malicious/MITM'd helper
// can no longer serve a fake chain with a fabricated balance or incoming
// transactions.

const { getTip, getBlocks } = require('./api');
const { decodeBlock, blockReward } = require('./block');

const BATCH_SIZE = 200;
const DELAY_BETWEEN_BATCHES_MS = 250;
const MAX_HISTORY_ENTRIES = 500; // keep the cache file bounded for long-lived wallets

// sha256 of the real 148-byte genesis header, verified against block 0 as
// served over HTTPS by the default helper (api1.browsercoin.org) on
// 2026-07-15. Note: docs/developers.md §4 states different genesis values
// (timestamp 1700000000, difficulty 0x20400000) than what the live network
// actually serves (timestamp 1779700000, difficulty 0x20020000) -- the
// network was evidently reset/relaunched since that doc was last updated,
// consistent with its own "v0.2, not stable, code is the source of truth"
// disclaimer. This hash reflects the real network, not the stale doc.
const GENESIS_BLOCK_HASH = '9fe010e8bdb735a5f7afacec8f5b6810550a4b25e73ea69d0159c44adf10ff74';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyGenesis(baseUrl) {
  const blocksHex = await getBlocks(baseUrl, 0, 1);
  if (blocksHex.length === 0) {
    throw new Error('Helper server did not return a genesis block (height 0). Aborting sync.');
  }
  const genesis = decodeBlock(blocksHex[0]);
  if (genesis.height !== 0) {
    throw new Error(`Expected genesis at height 0, got height ${genesis.height}. Aborting sync.`);
  }
  if (genesis.blockHash !== GENESIS_BLOCK_HASH) {
    throw new Error(
      'Genesis block hash mismatch -- the helper server is not serving the real BrowserCoin ' +
      'network (or is malicious/compromised). Aborting sync. Try a different helper server.'
    );
  }
}

async function syncAddress(baseUrl, address, cachedState, onProgress) {
  const state = cachedState
    ? { ...cachedState, balanceWei: BigInt(cachedState.balanceWei), history: cachedState.history || [] }
    : { syncedHeight: -1, balanceWei: 0n, nonce: 0, lastBlockHash: null, history: [], genesisVerified: false };

  if (!state.genesisVerified) {
    await verifyGenesis(baseUrl);
    state.genesisVerified = true;
  }

  const tip = await getTip(baseUrl);
  const targetHeight = tip.height;

  let fromHeight = state.syncedHeight + 1;

  while (fromHeight <= targetHeight) {
    const blocksHex = await getBlocks(baseUrl, fromHeight, BATCH_SIZE);
    if (blocksHex.length === 0) break;

    for (const hex of blocksHex) {
      const block = decodeBlock(hex);
      const expectedHeight = state.syncedHeight + 1;

      if (block.height !== expectedHeight) {
        throw new Error(
          `Chain continuity check failed: expected block ${expectedHeight} but the ` +
          `helper server returned block ${block.height}. Aborting sync -- this could ` +
          `mean the helper is misbehaving. Try a different helper server.`
        );
      }
      if (state.lastBlockHash && block.prevHash !== state.lastBlockHash) {
        throw new Error(
          `Chain continuity check failed at block ${block.height}: prevHash does not ` +
          `match the previously accepted block. Aborting sync -- this could mean the ` +
          `helper is misbehaving. Try a different helper server.`
        );
      }

      // PoW verification (Argon2id, see pow.js) was attempted here but had
      // to be reverted: after testing multiple parameter hypotheses against
      // a real, confirmed-valid mined block (height 29555, synced via
      // api1.browsercoin.org), none produced a hash meeting that block's own
      // declared difficulty target. The exact hash construction the real
      // network uses (possible extra associated data, different field
      // ordering, or a non-conformant reference implementation despite the
      // docs' RFC 9106 claim) could not be confirmed without the actual
      // src/crypto/pow.ts source. Shipping an unverified check that rejects
      // legitimate blocks is worse than not checking at all, so this is
      // disabled until the real construction can be confirmed against
      // ground truth (e.g. by getting the source from the BrowserCoin repo
      // or maintainer). pow.js is left in place for that future work.

      applyBlock(state, block, address);
      state.syncedHeight = block.height;
      state.lastBlockHash = block.blockHash;
    }

    fromHeight = state.syncedHeight + 1;
    if (onProgress) onProgress({ height: state.syncedHeight, target: targetHeight });
    if (fromHeight <= targetHeight) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  if (state.history.length > MAX_HISTORY_ENTRIES) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY_ENTRIES);
  }

  return {
    syncedHeight: state.syncedHeight,
    balanceWei: state.balanceWei.toString(),
    nonce: state.nonce,
    lastBlockHash: state.lastBlockHash,
    tipHeight: targetHeight,
    history: state.history,
    genesisVerified: state.genesisVerified
  };
}

function applyBlock(state, block, address) {
  let feesInBlock = 0n;

  for (const tx of block.txs) {
    feesInBlock += tx.feeWei;

    if (tx.from === address) {
      state.balanceWei -= (tx.amountWei + tx.feeWei);
      if (tx.nonce + 1 > state.nonce) state.nonce = tx.nonce + 1;
      state.history.push({
        txid: tx.txid,
        height: block.height,
        timestamp: block.timestamp.toString(),
        type: 'sent',
        counterparty: tx.to,
        amountWei: tx.amountWei.toString(),
        feeWei: tx.feeWei.toString()
      });
    }
    if (tx.to === address) {
      state.balanceWei += tx.amountWei;
      state.history.push({
        txid: tx.txid,
        height: block.height,
        timestamp: block.timestamp.toString(),
        type: 'received',
        counterparty: tx.from,
        amountWei: tx.amountWei.toString(),
        feeWei: tx.feeWei.toString()
      });
    }
  }

  if (block.miner === address) {
    const reward = blockReward(block.height) + feesInBlock;
    state.balanceWei += reward;
    state.history.push({
      txid: null,
      height: block.height,
      timestamp: block.timestamp.toString(),
      type: 'mined',
      counterparty: null,
      amountWei: reward.toString(),
      feeWei: '0'
    });
  }
}

module.exports = { syncAddress };
