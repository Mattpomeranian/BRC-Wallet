'use strict';

const { decodeTx, TX_SIZE } = require('./tx');
const { sha256 } = require('./crypto');

const HEADER_SIZE = 148;

function decodeBlock(hex) {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < HEADER_SIZE + 4) {
    throw new Error('Block too short');
  }
  const header = buf.slice(0, HEADER_SIZE);
  const height = header.readUInt32BE(0);
  const prevHash = header.slice(4, 36).toString('hex');
  const timestamp = header.readBigUInt64BE(100);
  const difficulty = header.readUInt32BE(108);
  const miner = header.slice(116, 148).toString('hex');
  const blockHash = sha256(header).toString('hex');

  const txCount = buf.readUInt32BE(HEADER_SIZE);
  const declaredBodySize = txCount * TX_SIZE;
  if (HEADER_SIZE + 4 + declaredBodySize > buf.length) {
    throw new Error(
      `Malformed block: declared tx count (${txCount}) exceeds the bytes actually received`
    );
  }

  const txs = [];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < txCount; i++) {
    const txHex = buf.slice(offset, offset + TX_SIZE).toString('hex');
    txs.push(decodeTx(txHex));
    offset += TX_SIZE;
  }

  return { height, prevHash, timestamp, difficulty, miner, blockHash, txs };
}

// Block reward with halving every 210,000 blocks, starting at 50 BRC.
function blockReward(height) {
  const COIN = 100000000n;
  const initial = 50n * COIN;
  const halvings = Math.floor(height / 210000);
  if (halvings >= 64) return 0n;
  return initial >> BigInt(halvings);
}

module.exports = { decodeBlock, blockReward, HEADER_SIZE };
