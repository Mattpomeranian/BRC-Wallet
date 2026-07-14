'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const qrcode = require('qrcode-generator');

const wallet = require('./src/wallet');
const { Store } = require('./src/store');
const { syncAddress } = require('./src/sync');
const { buildSignedTx, brcToWei, weiToBrc } = require('./src/tx');
const { submitTx } = require('./src/api');

let mainWindow;
let store;

// The private key is kept as a Buffer (mutable, zeroable) rather than a
// hex string (immutable in JS -- once created, a string's backing memory
// can't be overwritten, so it lingers until GC decides to reclaim it).
// clearCurrentWallet() below actively zeroes this buffer instead of just
// dropping the reference. Note this doesn't eliminate every trace: signing
// and export briefly materialize a hex-string copy of the key, and JS
// gives no way to zero string memory -- that's an inherent limitation of
// doing crypto in plain JS, not something this fix can fully close.
let currentWallet = null; // { address, privateKeyBuffer }
let pendingImportPath = null; // set when wallet:import hits an encrypted file
let sendInFlight = false; // guards against a nonce race on double-submit
let syncInFlight = false; // guards against redundant concurrent sync loops

function clearCurrentWallet() {
  if (currentWallet && currentWallet.privateKeyBuffer) {
    currentWallet.privateKeyBuffer.fill(0);
  }
  currentWallet = null;
}

function setCurrentWallet(walletRecord) {
  clearCurrentWallet();
  currentWallet = {
    address: walletRecord.address,
    privateKeyBuffer: Buffer.from(walletRecord.privateKeyHex, 'hex')
  };
}

function currentPrivateKeyHex() {
  return currentWallet.privateKeyBuffer.toString('hex');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  clearCurrentWallet();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearCurrentWallet();
});

// ---- IPC handlers ----

ipcMain.handle('wallet:create', async () => {
  setCurrentWallet(wallet.createWallet());
  return { address: currentWallet.address };
});

// Called once on renderer startup. If a wallet path was remembered from a
// previous session, this tries to pick up where the user left off: plain
// files load immediately (they have no protection to begin with, so there's
// nothing to gate on), encrypted files still require the password -- this
// never skips that step, it just saves re-browsing for the file.
ipcMain.handle('wallet:tryAutoLoad', async () => {
  const settings = store.readSettings();
  const lastPath = settings.lastWalletPath;
  if (!lastPath) return null;

  try {
    const w = wallet.loadWalletFile(lastPath);
    setCurrentWallet(w);
    return { address: currentWallet.address };
  } catch (e) {
    if (e.encrypted) {
      pendingImportPath = lastPath;
      return { needsPassword: true };
    }
    // File missing, moved, or unreadable -- forget it instead of failing
    // on every future launch.
    store.writeSettings({ ...settings, lastWalletPath: null });
    return null;
  }
});

ipcMain.handle('wallet:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import a BrowserCoin wallet',
    filters: [{ name: 'Wallet JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const w = wallet.loadWalletFile(filePath);
    setCurrentWallet(w);
    pendingImportPath = null;
    store.writeSettings({ ...store.readSettings(), lastWalletPath: filePath });
    return { address: currentWallet.address };
  } catch (e) {
    if (e.encrypted) {
      pendingImportPath = filePath;
      return { needsPassword: true };
    }
    throw e;
  }
});

ipcMain.handle('wallet:unlock', async (_evt, password) => {
  if (!pendingImportPath) throw new Error('No import pending');
  const w = await wallet.loadEncryptedWalletFile(pendingImportPath, password);
  setCurrentWallet(w);
  store.writeSettings({ ...store.readSettings(), lastWalletPath: pendingImportPath });
  pendingImportPath = null;
  return { address: currentWallet.address };
});

ipcMain.handle('wallet:export', async (_evt, password) => {
  if (!currentWallet) throw new Error('No wallet loaded');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export wallet',
    defaultPath: `browsercoin-wallet-${currentWallet.address.slice(0, 8)}.json`,
    filters: [{ name: 'Wallet JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return null;

  const exportable = { address: currentWallet.address, privateKeyHex: currentPrivateKeyHex() };
  if (password) {
    wallet.checkPasswordStrength(password); // throws a clear error if too weak
    await wallet.saveEncryptedWalletFile(result.filePath, exportable, password);
  } else {
    wallet.saveWalletFile(result.filePath, exportable);
  }
  return result.filePath;
});

ipcMain.handle('wallet:current', async () => {
  if (!currentWallet) return null;
  return { address: currentWallet.address };
});

ipcMain.handle('wallet:qrCode', async () => {
  if (!currentWallet) throw new Error('No wallet loaded');
  const qr = qrcode(0, 'M'); // type 0 = auto-sized, 'M' = medium error correction
  qr.addData(currentWallet.address);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
});

ipcMain.handle('wallet:history', async () => {
  if (!currentWallet) return [];
  const cached = store.readSyncCache(currentWallet.address);
  return cached && cached.history ? cached.history : [];
});

ipcMain.handle('settings:get', async () => {
  return store.readSettings();
});

ipcMain.handle('settings:setApiBaseUrl', async (_evt, url) => {
  const trimmed = String(url || '').trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    throw new Error('The helper server URL is not valid (e.g. https://api1.browsercoin.org)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The helper server URL must start with http:// or https://');
  }
  // Strip any trailing slash so `${apiBaseUrl}/tip` never ends up with a
  // doubled slash, which some servers treat as a different (404) route.
  const normalized = trimmed.replace(/\/+$/, '');
  const settings = store.readSettings();
  settings.apiBaseUrl = normalized;
  store.writeSettings(settings);
  return settings;
});

ipcMain.handle('wallet:sync', async () => {
  if (!currentWallet) throw new Error('No wallet loaded');
  if (syncInFlight) {
    throw new Error('A sync is already in progress -- please wait for it to finish first.');
  }
  syncInFlight = true;
  try {
    const settings = store.readSettings();
    const cached = store.readSyncCache(currentWallet.address);
    const result = await syncAddress(settings.apiBaseUrl, currentWallet.address, cached, (progress) => {
      mainWindow.webContents.send('wallet:syncProgress', progress);
    });
    store.writeSyncCache(currentWallet.address, result);
    return { ...result, balanceBrc: weiToBrc(result.balanceWei) };
  } finally {
    syncInFlight = false;
  }
});

ipcMain.handle('wallet:send', async (_evt, { to, amountBrc, feeBrc }) => {
  if (!currentWallet) throw new Error('No wallet loaded');
  if (sendInFlight) {
    throw new Error('A transaction is already being sent -- please wait for it to finish first.');
  }
  sendInFlight = true;
  try {
    const settings = store.readSettings();

    const toClean = String(to).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(toClean)) {
      throw new Error('Invalid recipient address (64 hex characters expected)');
    }
    // Note: earlier drafts of this app blocked sending to your own address,
    // on the assumption the network rejects self-sends. That assumption
    // wasn't actually backed by the BrowserCoin API docs, so it's been
    // removed -- the network is the source of truth for what's valid.

    const amountWei = brcToWei(amountBrc);
    const feeWei = feeBrc ? brcToWei(feeBrc) : 152n; // minimum fee per docs
    if (feeWei < 152n) throw new Error('Minimum fee: 0.00000152 BRC');

    const cached = store.readSyncCache(currentWallet.address);
    if (!cached) throw new Error('Sync the wallet first to know the current nonce');

    const nonce = cached.nonce;
    const { hex, txid } = buildSignedTx({
      from: currentWallet.address,
      to: toClean,
      amountWei,
      feeWei,
      nonce,
      privateKeyHex: currentPrivateKeyHex()
    });

    const res = await submitTx(settings.apiBaseUrl, hex);
    if (res.admitted !== 1) {
      throw new Error(res.errors && res.errors[0] ? res.errors[0] : 'Transaction rejected by the server');
    }

    // Optimistically bump the local nonce so a second send in the same
    // session doesn't reuse it before the next sync.
    cached.nonce = nonce + 1;
    store.writeSyncCache(currentWallet.address, cached);

    return { txid };
  } finally {
    sendInFlight = false;
  }
});
