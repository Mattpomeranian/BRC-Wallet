'use strict';

// There is no /account or /balance endpoint on the helper server (see
// docs/developers.md §10: "fetch your account's current nonce by replaying
// the chain or querying an explorer you trust"). So this wallet keeps a
// small local cache (last synced height + running balance/nonce for our
// own address) and replays only the blocks it hasn't seen yet.
//
// Trust note: this trusts the helper server's block CONTENTS as-is (it does
// not re-verify proof-of-work or the txRoot/stateRoot Merkle commitments --
// doing that would require a full Argon2id + Merkle implementation and
// would make sync far slower). What it DOES verify is chain continuity:
// each block's declared height must be exactly one more than the last, and
// its prevHash must match the hash of the block we previously accepted. A
// helper that tries to splice in an inconsistent or out-of-order block gets
// caught here and sync aborts with a clear error instead of silently
// producing a wrong balance. This is NOT a full validating node -- PoW and
// Merkle roots are still unchecked -- but it closes the cheapest and
// easiest attack a misbehaving helper could otherwise pull off.

const { getTip, getBlocks } = require('./api');
const { decodeBlock, blockReward } = require('./block');

const BATCH_SIZE = 200;
const DELAY_BETWEEN_BATCHES_MS = 250;
const MAX_HISTORY_ENTRIES = 500; // keep the cache file bounded for long-lived wallets

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncAddress(baseUrl, address, cachedState, onProgress) {
  const state = cachedState
    ? { ...cachedState, balanceWei: BigInt(cachedState.balanceWei), history: cachedState.history || [] }
    : { syncedHeight: -1, balanceWei: 0n, nonce: 0, lastBlockHash: null, history: [] };

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
    history: state.history
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
