'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brcWallet', {
  createWallet: () => ipcRenderer.invoke('wallet:create'),
  tryAutoLoad: () => ipcRenderer.invoke('wallet:tryAutoLoad'),
  importWallet: () => ipcRenderer.invoke('wallet:import'),
  unlockWallet: (password) => ipcRenderer.invoke('wallet:unlock', password),
  exportWallet: (password) => ipcRenderer.invoke('wallet:export', password),
  currentWallet: () => ipcRenderer.invoke('wallet:current'),
  getAddressQrCode: () => ipcRenderer.invoke('wallet:qrCode'),
  getHistory: () => ipcRenderer.invoke('wallet:history'),
  sync: () => ipcRenderer.invoke('wallet:sync'),
  send: (payload) => ipcRenderer.invoke('wallet:send', payload),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiBaseUrl: (url) => ipcRenderer.invoke('settings:setApiBaseUrl', url),
  onSyncProgress: (callback) => {
    ipcRenderer.on('wallet:syncProgress', (_evt, progress) => callback(progress));
  }
});
