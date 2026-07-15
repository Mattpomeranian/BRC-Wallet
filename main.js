'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let qrcode, wallet, Store, syncAddress, buildSignedTx, brcToWei, weiToBrc, submitTx;
try {
  qrcode = require('qrcode-generator');
  wallet = require('./src/wallet');
  ({ Store } = require('./src/store'));
  ({ syncAddress } = require('./src/sync'));
  ({ buildSignedTx, brcToWei, weiToBrc } = require('./src/tx'));
  ({ submitTx } = require('./src/api'));
} catch (err) {
  // A raw Node "Cannot find module" crash here looks like the app itself is
  // broken. It's almost always just node_modules being stale after a
  // package.json change -- catch it and say so directly instead of letting
  // Electron show its default uncaught-exception dialog with a stack trace.
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'BRC Wallet failed to start',
      `A required file could not be loaded:\n${err.message}\n\n` +
      `This almost always means dependencies need to be installed or reinstalled. ` +
      `Close this window, open a terminal in the app folder, and run:\n\n` +
      `    npm install\n\n` +
      `Then start the app again.`
    );
    app.quit();
  });
  return;
}

const GITHUB_REPO = 'Mattpomeranian/BRC-Wallet';
const AUTO_SYNC_INTERVALS_MS = [30000, 60000, 120000, 300000];

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
let pendingImportPath = null; // set when an import/switch hits an encrypted file
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

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
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

// ---- IPC handlers: wallet lifecycle ----

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
    store.upsertWallet({ address: currentWallet.address, filePath: lastPath });
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
    store.upsertWallet({ address: currentWallet.address, filePath });
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
  store.upsertWallet({ address: currentWallet.address, filePath: pendingImportPath });
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
  store.upsertWallet({ address: currentWallet.address, filePath: result.filePath });
  return result.filePath;
});

ipcMain.handle('wallet:current', async () => {
  if (!currentWallet) return null;
  return { address: currentWallet.address };
});

// ---- IPC handlers: saved wallet registry / switcher ----

ipcMain.handle('wallet:listSaved', async () => {
  return store.readWallets();
});

ipcMain.handle('wallet:switchTo', async (_evt, filePath) => {
  try {
    const w = wallet.loadWalletFile(filePath);
    setCurrentWallet(w);
    pendingImportPath = null;
    store.writeSettings({ ...store.readSettings(), lastWalletPath: filePath });
    store.upsertWallet({ address: currentWallet.address, filePath });
    return { address: currentWallet.address };
  } catch (e) {
    if (e.encrypted) {
      pendingImportPath = filePath;
      return { needsPassword: true };
    }
    throw e;
  }
});

ipcMain.handle('wallet:renameSaved', async (_evt, { address, label }) => {
  const trimmed = String(label || '').trim().slice(0, 60);
  if (!trimmed) throw new Error('Name cannot be empty');
  return store.renameWallet(address, trimmed);
});

ipcMain.handle('wallet:removeSaved', async (_evt, address) => {
  // Only forgets it from the switcher list -- never touches the actual file.
  return store.removeWallet(address);
});

// ---- IPC handlers: QR, history, CSV ----

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

ipcMain.handle('wallet:exportHistoryCsv', async () => {
  if (!currentWallet) throw new Error('No wallet loaded');
  const cached = store.readSyncCache(currentWallet.address);
  const history = cached && cached.history ? cached.history : [];

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export transaction history',
    defaultPath: `brc-history-${currentWallet.address.slice(0, 8)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return null;

  const escapeCsv = (v) => {
    const s = String(v === undefined || v === null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [['Date (UTC)', 'Type', 'Amount (BRC)', 'Fee (BRC)', 'Counterparty', 'Block height', 'TXID']];
  for (const entry of history) {
    rows.push([
      new Date(Number(entry.timestamp) * 1000).toISOString(),
      entry.type,
      weiToBrc(entry.amountWei),
      entry.feeWei && entry.feeWei !== '0' ? weiToBrc(entry.feeWei) : '0',
      entry.counterparty || '',
      entry.height,
      entry.txid || ''
    ]);
  }
  const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
  fs.writeFileSync(result.filePath, csv, { encoding: 'utf8', mode: 0o600 });
  return result.filePath;
});

// ---- IPC handlers: settings ----

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

ipcMain.handle('settings:setAutoSyncInterval', async (_evt, ms) => {
  const value = Number(ms);
  if (!AUTO_SYNC_INTERVALS_MS.includes(value)) {
    throw new Error('Invalid auto-sync interval');
  }
  const settings = store.readSettings();
  settings.autoSyncIntervalMs = value;
  store.writeSettings(settings);
  return settings;
});

ipcMain.handle('settings:setTheme', async (_evt, theme) => {
  if (theme !== 'dark' && theme !== 'light') {
    throw new Error('Invalid theme');
  }
  const settings = store.readSettings();
  settings.theme = theme;
  store.writeSettings(settings);
  return settings;
});

// ---- IPC handlers: app info / updates ----

ipcMain.handle('app:getVersion', async () => {
  return app.getVersion();
});

ipcMain.handle('app:checkUpdate', async () => {
  const currentVersion = app.getVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BRC-Wallet' },
      signal: controller.signal
    });
    if (res.status === 404) {
      return { currentVersion, latestVersion: null, hasUpdate: false, message: 'No releases published yet.' };
    }
    if (res.status === 403) {
      return { currentVersion, latestVersion: null, hasUpdate: false, message: 'GitHub rate-limited this check -- try again in a bit.' };
    }
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = await res.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
    return { currentVersion, latestVersion: latestVersion || null, hasUpdate, releaseUrl: data.html_url || null };
  } catch (e) {
    const message = e.name === 'AbortError' ? 'Request timed out' : e.message;
    return { currentVersion, latestVersion: null, hasUpdate: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle('app:openExternal', async (_evt, url) => {
  const trimmed = String(url || '');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (e) {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Only https links can be opened');
  if (parsed.hostname !== 'github.com') throw new Error('Only github.com links can be opened');
  await shell.openExternal(trimmed);
});

// ---- IPC handlers: sync / send ----

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
