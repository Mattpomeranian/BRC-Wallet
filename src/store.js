'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  lastWalletPath: null,
  apiBaseUrl: 'https://api1.browsercoin.org',
  autoSyncIntervalMs: 60000,
  theme: 'dark'
};

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.settingsPath = path.join(this.dir, 'settings.json');
    this.walletsPath = path.join(this.dir, 'wallets.json');
    this.syncCacheDir = path.join(this.dir, 'sync-cache');
    if (!fs.existsSync(this.syncCacheDir)) {
      fs.mkdirSync(this.syncCacheDir, { recursive: true, mode: 0o700 });
    }
  }

  readSettings() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      // Merge with defaults so settings files written by older versions
      // (missing newer fields) still get sane values instead of undefined.
      return { ...DEFAULT_SETTINGS, ...stored };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  writeSettings(settings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  syncCachePath(address) {
    return path.join(this.syncCacheDir, `${address}.json`);
  }

  readSyncCache(address) {
    try {
      return JSON.parse(fs.readFileSync(this.syncCachePath(address), 'utf8'));
    } catch {
      return null;
    }
  }

  writeSyncCache(address, state) {
    fs.writeFileSync(this.syncCachePath(address), JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  // ---- Saved wallet registry (address, display label, file path) ----
  // Note: this never stores key material -- just enough to re-open a file
  // the user already saved elsewhere and offer a friendly label for it.

  readWallets() {
    try {
      const list = JSON.parse(fs.readFileSync(this.walletsPath, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  writeWallets(list) {
    fs.writeFileSync(this.walletsPath, JSON.stringify(list, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  upsertWallet({ address, filePath, label }) {
    const list = this.readWallets();
    const existing = list.find((w) => w.address === address);
    if (existing) {
      existing.filePath = filePath;
      if (label && !existing.label) existing.label = label;
    } else {
      list.push({ address, filePath, label: label || `Wallet ${address.slice(0, 8)}` });
    }
    this.writeWallets(list);
    return list;
  }

  renameWallet(address, label) {
    const list = this.readWallets();
    const entry = list.find((w) => w.address === address);
    if (entry) entry.label = label;
    this.writeWallets(list);
    return list;
  }

  removeWallet(address) {
    const list = this.readWallets().filter((w) => w.address !== address);
    this.writeWallets(list);
    return list;
  }
}

module.exports = { Store };
