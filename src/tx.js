'use strict';

const { sign: edSign, sha256 } = require('./crypto');

const CHAIN_ID = 0xc01dfeed;
const TX_SIZE = 152;
const PREIMAGE_SIZE = 88;
const COIN = 100000000n; // 1 BRC = 10^8 wei

function writeU32BE(buf, offset, value) {
  buf.writeUInt32BE(value >>> 0, offset);
}

function writeU64BE(buf, offset, value) {
  buf.writeBigUInt64BE(BigInt(value), offset);
}

function readU32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readU64BE(buf, offset) {
  return buf.readBigUInt64BE(offset);
}

// Builds the 88-byte signed preimage for a transaction.
function encodePreimage({ from, to, amountWei, feeWei, nonce }) {
  const buf = Buffer.alloc(PREIMAGE_SIZE);
  writeU32BE(buf, 0, CHAIN_ID);
  Buffer.from(from, 'hex').copy(buf, 4);
  Buffer.from(to, 'hex').copy(buf, 36);
  writeU64BE(buf, 68, amountWei);
  writeU64BE(buf, 76, feeWei);
  writeU32BE(buf, 84, nonce);
  return buf;
}

// Signs a transaction and returns the full 152-byte encoding as a hex string.
function buildSignedTx({ from, to, amountWei, feeWei, nonce, privateKeyHex }) {
  const preimage = encodePreimage({ from, to, amountWei, feeWei, nonce });
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const signature = edSign(preimage, privateKey);
  const full = Buffer.concat([preimage, signature]);
  if (full.length !== TX_SIZE) {
    throw new Error(`Invalid tx encoding: ${full.length} bytes (expected ${TX_SIZE})`);
  }
  return {
    hex: full.toString('hex'),
    txid: sha256(full).toString('hex')
  };
}

// Decodes a 152-byte hex tx (used when reading blocks during sync).
function decodeTx(hex) {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== TX_SIZE) {
    throw new Error(`Unexpected tx size: ${buf.length}`);
  }
  return {
    txid: sha256(buf).toString('hex'),
    chainId: readU32BE(buf, 0),
    from: buf.slice(4, 36).toString('hex'),
    to: buf.slice(36, 68).toString('hex'),
    amountWei: readU64BE(buf, 68),
    feeWei: readU64BE(buf, 76),
    nonce: readU32BE(buf, 84),
    signature: buf.slice(88, 152).toString('hex')
  };
}

function brcToWei(brcAmountStr) {
  // Parses a decimal string like "1.5" into integer wei (10^8 per BRC),
  // avoiding floating point rounding issues.
  const s = String(brcAmountStr).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid amount');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 8) throw new Error('Too many decimals (max 8)');
  const fracPadded = (frac + '00000000').slice(0, 8);
  return BigInt(whole) * COIN + BigInt(fracPadded || '0');
}

function weiToBrc(wei) {
  const w = BigInt(wei);
  const whole = w / COIN;
  const frac = w % COIN;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

module.exports = {
  CHAIN_ID,
  TX_SIZE,
  PREIMAGE_SIZE,
  COIN,
  encodePreimage,
  buildSignedTx,
  decodeTx,
  brcToWei,
  weiToBrc
};
