'use strict';

const fs = require('fs');
const path = require('path');

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.settingsPath = path.join(this.dir, 'settings.json');
    this.syncCacheDir = path.join(this.dir, 'sync-cache');
    if (!fs.existsSync(this.syncCacheDir)) {
      fs.mkdirSync(this.syncCacheDir, { recursive: true, mode: 0o700 });
    }
  }

  readSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    } catch {
      return { lastWalletPath: null, apiBaseUrl: 'https://api1.browsercoin.org' };
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
}

module.exports = { Store };
