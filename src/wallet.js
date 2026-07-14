'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const { randomPrivateKey, getPublicKey } = require('./crypto');

const scrypt = promisify(crypto.scrypt);

const WALLET_TYPE = 'browsercoin-wallet';
// N=131072 (2^17) meets the current OWASP minimum for scrypt protecting a
// high-value secret (~128 MiB / ~1s on typical hardware). The previous
// N=16384 was too weak for something as sensitive as a private key.
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1 };
const MIN_PASSWORD_LENGTH = 8;

// Thrown when a file requires a password to read. Callers should catch this
// specifically and re-prompt rather than treating it as a generic failure.
class EncryptedWalletError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EncryptedWalletError';
    this.encrypted = true;
  }
}

function baseWalletRecord(privateKey) {
  const publicKey = getPublicKey(privateKey);
  return {
    address: publicKey.toString('hex'),
    privateKeyHex: privateKey.toString('hex')
  };
}

function createWallet() {
  return { type: WALLET_TYPE, version: 1, ...baseWalletRecord(randomPrivateKey()),
    warning: 'Anyone with the private key controls the wallet. Keep this safe.' };
}

function walletFromPrivateKeyHex(privateKeyHex) {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  if (privateKey.length !== 32) {
    throw new Error('Invalid private key (32 bytes expected)');
  }
  return { type: WALLET_TYPE, version: 1, ...baseWalletRecord(privateKey),
    warning: 'Anyone with the private key controls the wallet. Keep this safe.' };
}

function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

// ---- Encryption at rest (scrypt key derivation + AES-256-GCM) ----

async function encryptPrivateKeyHex(privateKeyHex, password) {
  checkPasswordStrength(password);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, { ...SCRYPT_PARAMS, maxmem: 512 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKeyHex, 'hex')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    kdf: 'scrypt',
    kdfParams: { ...SCRYPT_PARAMS, salt: salt.toString('hex') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
}

async function decryptPrivateKeyHex(enc, password) {
  try {
    const salt = Buffer.from(enc.kdfParams.salt, 'hex');
    const { N, r, p } = enc.kdfParams;
    // maxmem must cover N*r*128 bytes or scrypt throws for larger N/r combos.
    const key = await scrypt(password, salt, 32, { N, r, p, maxmem: 512 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(enc.authTag, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'hex')), decipher.final()]);
    return plain.toString('hex');
  } catch (e) {
    throw new Error('Incorrect password or corrupted file');
  }
}

// ---- File I/O ----

function parseWalletJson(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Invalid JSON file');
  }

  if (data.encrypted) {
    throw new EncryptedWalletError('This wallet is encrypted, a password is required');
  }

  if (!data.privateKeyHex) {
    throw new Error('Missing privateKeyHex field in the file');
  }
  const wallet = walletFromPrivateKeyHex(data.privateKeyHex);
  if (data.address && data.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("The file's address does not match the provided private key");
  }
  return wallet;
}

async function parseEncryptedWalletJson(jsonText, password) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Invalid JSON file');
  }
  if (!data.encrypted) throw new Error("This file is not encrypted");
  const privateKeyHex = await decryptPrivateKeyHex(data, password);
  const wallet = walletFromPrivateKeyHex(privateKeyHex);
  if (data.address && data.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("The file's address does not match the decrypted key");
  }
  return wallet;
}

function loadWalletFile(path) {
  const text = fs.readFileSync(path, 'utf8');
  return parseWalletJson(text); // throws EncryptedWalletError if the file is encrypted
}

async function loadEncryptedWalletFile(path, password) {
  const text = fs.readFileSync(path, 'utf8');
  return parseEncryptedWalletJson(text, password);
}

// Plain export -- matches the original browser wallet format exactly, for
// compatibility with browsercoin.org's own import/export.
function saveWalletFile(path, wallet) {
  const out = {
    type: WALLET_TYPE,
    version: 1,
    address: wallet.address,
    privateKeyHex: wallet.privateKeyHex,
    warning: 'Anyone with the private key controls the wallet. Keep this safe.'
  };
  fs.writeFileSync(path, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// Encrypted export -- recommended. Not directly importable by the plain
// browser wallet without decrypting first (browsercoin.org has no concept
// of this format), but re-importable by this app with the password.
async function saveEncryptedWalletFile(path, wallet, password) {
  const enc = await encryptPrivateKeyHex(wallet.privateKeyHex, password);
  const out = {
    type: WALLET_TYPE,
    version: 2,
    address: wallet.address,
    encrypted: true,
    ...enc,
    warning: 'This file is password-protected, but treat it as sensitive regardless.'
  };
  fs.writeFileSync(path, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 });
}

module.exports = {
  EncryptedWalletError,
  MIN_PASSWORD_LENGTH,
  checkPasswordStrength,
  createWallet,
  walletFromPrivateKeyHex,
  parseWalletJson,
  parseEncryptedWalletJson,
  loadWalletFile,
  loadEncryptedWalletFile,
  saveWalletFile,
  saveEncryptedWalletFile
};
