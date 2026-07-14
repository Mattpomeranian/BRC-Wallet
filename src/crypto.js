'use strict';

// Ed25519 via Node's built-in crypto module (available since Node 12,
// stable since Node 16). No external dependency needed -- this sidesteps
// the @noble/ed25519 v2 ESM-only packaging issue entirely (it can't be
// require()'d from Electron's main process, which is CommonJS).
//
// Node's Ed25519 keys are wrapped in DER (PKCS8 for private, SPKI for
// public). Ed25519 DER encodings have a fixed-size ASN.1 prefix since the
// algorithm has no parameters, so we can just concatenate a constant prefix
// with the raw 32-byte key material instead of pulling in an ASN.1 library.

const nodeCrypto = require('crypto');

// DER prefix for PKCS8-wrapped raw Ed25519 private key (RFC 8410).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
// DER prefix for SPKI-wrapped raw Ed25519 public key (RFC 8410).
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function sha256(buf) {
  return nodeCrypto.createHash('sha256').update(buf).digest();
}

function randomPrivateKey() {
  return nodeCrypto.randomBytes(32);
}

function privateKeyObjectFromSeed(seedBytes) {
  const seed = Buffer.from(seedBytes);
  if (seed.length !== 32) throw new Error('Invalid Ed25519 seed (32 bytes expected)');
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  return nodeCrypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function publicKeyObjectFromRaw(pubBytes) {
  const pub = Buffer.from(pubBytes);
  if (pub.length !== 32) throw new Error('Invalid Ed25519 public key (32 bytes expected)');
  const der = Buffer.concat([SPKI_PREFIX, pub]);
  return nodeCrypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function getPublicKey(privateKeyBytes) {
  const keyObj = privateKeyObjectFromSeed(privateKeyBytes);
  const pubKeyObj = nodeCrypto.createPublicKey(keyObj);
  const spki = pubKeyObj.export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.slice(spki.length - 32));
}

function sign(messageBytes, privateKeyBytes) {
  const keyObj = privateKeyObjectFromSeed(privateKeyBytes);
  // null algorithm = pure Ed25519 (no prehash), per RFC 8032 / Node docs.
  return nodeCrypto.sign(null, Buffer.from(messageBytes), keyObj);
}

function verify(signatureBytes, messageBytes, publicKeyBytes) {
  const pubKeyObj = publicKeyObjectFromRaw(publicKeyBytes);
  return nodeCrypto.verify(null, Buffer.from(messageBytes), pubKeyObj, Buffer.from(signatureBytes));
}

module.exports = { sha256, randomPrivateKey, getPublicKey, sign, verify };
