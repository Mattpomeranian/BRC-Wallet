'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brcWallet', {
  createWallet: () => ipcRenderer.invoke('wallet:create'),
  tryAutoLoad: () => ipcRenderer.invoke('wallet:tryAutoLoad'),
  importWallet: () => ipcRenderer.invoke('wallet:import'),
  unlockWallet: (password) => ipcRenderer.invoke('wallet:unlock', password),
  exportWallet: (password) => ipcRenderer.invoke('wallet:export', password),
  currentWallet: () => ipcRenderer.invoke('wallet:current'),

  listSavedWallets: () => ipcRenderer.invoke('wallet:listSaved'),
  switchWallet: (filePath) => ipcRenderer.invoke('wallet:switchTo', filePath),
  renameSavedWallet: (address, label) => ipcRenderer.invoke('wallet:renameSaved', { address, label }),
  removeSavedWallet: (address) => ipcRenderer.invoke('wallet:removeSaved', address),

  getAddressQrCode: (customColor) => ipcRenderer.invoke('wallet:qrCode', customColor),
  getHistory: () => ipcRenderer.invoke('wallet:history'),
  exportHistoryCsv: () => ipcRenderer.invoke('wallet:exportHistoryCsv'),
  getPremiumStatus: () => ipcRenderer.invoke('wallet:premiumStatus'),

  listAddressBook: () => ipcRenderer.invoke('addressBook:list'),
  addAddressBookEntry: (name, address) => ipcRenderer.invoke('addressBook:add', { name, address }),
  removeAddressBookEntry: (address) => ipcRenderer.invoke('addressBook:remove', address),
  renameAddressBookEntry: (address, name) => ipcRenderer.invoke('addressBook:rename', { address, name }),

  sync: () => ipcRenderer.invoke('wallet:sync'),
  send: (payload) => ipcRenderer.invoke('wallet:send', payload),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiBaseUrl: (url) => ipcRenderer.invoke('settings:setApiBaseUrl', url),
  setAutoSyncInterval: (ms) => ipcRenderer.invoke('settings:setAutoSyncInterval', ms),
  setTheme: (theme) => ipcRenderer.invoke('settings:setTheme', theme),
  setAccentColor: (color) => ipcRenderer.invoke('settings:setAccentColor', color),
  setQrStyle: (color) => ipcRenderer.invoke('settings:setQrStyle', color),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('settings:setNotificationsEnabled', enabled),

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  onSyncProgress: (callback) => {
    ipcRenderer.on('wallet:syncProgress', (_evt, progress) => callback(progress));
  }
});
