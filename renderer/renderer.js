'use strict';

const screenEmpty = document.getElementById('screen-empty');
const screenWallet = document.getElementById('screen-wallet');

const el = {
  address: document.getElementById('wallet-address'),
  balance: document.getElementById('wallet-balance'),
  syncStatus: document.getElementById('sync-status'),
  apiUrl: document.getElementById('api-url'),
  apiUrlSelect: document.getElementById('api-url-select'),
  sendTo: document.getElementById('send-to'),
  sendAmount: document.getElementById('send-amount'),
  sendFee: document.getElementById('send-fee'),
  sendResult: document.getElementById('send-result'),
  btnSend: document.getElementById('btn-send'),
  btnDonate: document.getElementById('btn-donate'),
  btnSync: document.getElementById('btn-sync'),
  qrWrap: document.getElementById('qr-wrap'),
  qrImg: document.getElementById('qr-code'),
  btnToggleQr: document.getElementById('btn-toggle-qr'),
  historyList: document.getElementById('history-list'),
  autoSyncToggle: document.getElementById('auto-sync-toggle'),
  autoSyncIntervalSelect: document.getElementById('auto-sync-interval-select'),
  themeSelect: document.getElementById('theme-select'),
  appVersion: document.getElementById('app-version'),
  btnCheckUpdate: document.getElementById('btn-check-update'),
  updateStatus: document.getElementById('update-status'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  walletTitle: document.getElementById('wallet-title'),
  switcherOverlay: document.getElementById('switcher-overlay'),
  switcherList: document.getElementById('switcher-list'),
  switcherClose: document.getElementById('switcher-close'),
  switcherImport: document.getElementById('switcher-import'),
  switcherCreate: document.getElementById('switcher-create'),
  btnOpenSwitcherEmpty: document.getElementById('btn-open-switcher-empty'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  premiumProgress: document.getElementById('premium-progress'),
  historySearch: document.getElementById('history-search'),
  historySearchLocked: document.getElementById('history-search-locked'),
  addressbookLocked: document.getElementById('addressbook-locked'),
  addressbookUnlocked: document.getElementById('addressbook-unlocked'),
  addressbookList: document.getElementById('addressbook-list'),
  abName: document.getElementById('ab-name'),
  abAddress: document.getElementById('ab-address'),
  btnAbAdd: document.getElementById('btn-ab-add'),
  btnPickAddress: document.getElementById('btn-pick-address'),
  statsLocked: document.getElementById('stats-locked'),
  statsUnlocked: document.getElementById('stats-unlocked'),
  statsContent: document.getElementById('stats-content'),
  accentLocked: document.getElementById('accent-locked'),
  accentUnlocked: document.getElementById('accent-unlocked'),
  accentSelect: document.getElementById('accent-select'),
  qrColorSelect: document.getElementById('qr-color-select'),
  notificationsLocked: document.getElementById('notifications-locked'),
  notificationsToggleWrap: document.getElementById('notifications-toggle-wrap'),
  notificationsToggle: document.getElementById('notifications-toggle')
};

// Same strict decimal format the main process enforces in tx.js's
// brcToWei(). Keeping these in sync means the confirmation dialog never
// shows a value that the send call would later reject as malformed (e.g.
// scientific notation, which passes a loose Number() check but isn't a
// valid BRC amount on the wire).
const AMOUNT_RE = /^\d+(\.\d{1,8})?$/;
const ADDRESS_RE = /^[0-9a-fA-F]{64}$/;
const COIN = 100000000n;

// Display-only formatting (mirrors tx.js's weiToBrc; duplicated on purpose
// since it's pure presentation logic, not signing-sensitive, and keeping
// the renderer free of a dependency on main-process modules).
function weiToBrcDisplay(weiStr) {
  const w = BigInt(weiStr);
  const whole = w / COIN;
  const frac = w % COIN;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// Rounded 2-decimal display for the compact history list -- full precision
// is still shown in the transaction detail view via weiToBrcDisplay above.
function weiToBrcShort(weiStr) {
  const w = BigInt(weiStr);
  const whole = w / COIN;
  const frac = (w % COIN) / (COIN / 100n); // hundredths
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}
function shortAddr(addr) {
  return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '';
}

function formatDate(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

// BRC donation address.
const DONATION_ADDRESS = 'a312575c148aac8d7f601a42975595203f4504524ead2a22a150d26c98fe6ce0';

// ---- Tiny DOM-building helper (no innerHTML anywhere in this file) ----
// Every value that could ever contain user input goes through textContent,
// never string concatenation into markup. This is the fix for a bug where
// the "fee" field was previously interpolated into innerHTML unescaped.
function h(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.className) node.className = opts.className;
  if (opts.title) node.title = opts.title;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const child of children) node.appendChild(child);
  return node;
}

// ---- Generic modal (used for password prompts, confirmations, details) ----

const modal = {
  overlay: document.getElementById('modal-overlay'),
  title: document.getElementById('modal-title'),
  message: document.getElementById('modal-message'),
  input: document.getElementById('modal-input'),
  ok: document.getElementById('modal-ok'),
  cancel: document.getElementById('modal-cancel')
};

// `buildMessage` is a function returning either a string (safe, no markup)
// or a DOM Node/array of Nodes built via h() above -- never raw HTML.
function openModal({ title, buildMessage, showInput, inputType = 'password', okLabel = 'OK', hideCancel = false }) {
  return new Promise((resolve) => {
    modal.title.textContent = title;
    modal.message.replaceChildren();
    const content = buildMessage ? buildMessage() : '';
    if (typeof content === 'string') {
      modal.message.textContent = content;
    } else if (Array.isArray(content)) {
      for (const node of content) modal.message.appendChild(node);
    } else if (content) {
      modal.message.appendChild(content);
    }

    modal.input.value = '';
    modal.input.type = inputType;
    modal.input.classList.toggle('hidden', !showInput);
    modal.ok.textContent = okLabel;
    modal.cancel.classList.toggle('hidden', hideCancel);
    modal.overlay.classList.remove('hidden');
    if (showInput) setTimeout(() => modal.input.focus(), 0);

    function cleanup(result) {
      modal.overlay.classList.add('hidden');
      modal.cancel.classList.remove('hidden');
      modal.ok.removeEventListener('click', onOk);
      modal.cancel.removeEventListener('click', onCancel);
      modal.input.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onOk() { cleanup(showInput ? modal.input.value : true); }
    function onCancel() { cleanup(null); }
    function onKeydown(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }
    modal.ok.addEventListener('click', onOk);
    modal.cancel.addEventListener('click', onCancel);
    modal.input.addEventListener('keydown', onKeydown);
  });
}

function askPassword(title, message) {
  return openModal({ title, buildMessage: () => message, showInput: true, inputType: 'password' });
}

function confirmAction(title, buildMessage, okLabel) {
  return openModal({ title, buildMessage, showInput: false, okLabel });
}

function showInfo(title, buildMessage) {
  return openModal({ title, buildMessage, showInput: false, okLabel: 'Close', hideCancel: true });
}

// ---- Screens ----

function showWalletScreen(address) {
  el.address.textContent = address;
  el.balance.textContent = '-';
  el.syncStatus.textContent = 'Not synced';
  el.qrWrap.classList.add('hidden');
  el.qrImg.removeAttribute('src');
  el.btnToggleQr.textContent = 'Show QR';
  el.historyList.replaceChildren(h('div', { text: 'Sync to load history.', className: 'muted small-text' }));
  screenEmpty.classList.add('hidden');
  screenWallet.classList.remove('hidden');
  resetToOverviewTab();
  refreshHistory();
  refreshPremiumStatus();
  startAutoSync();
}

function showEmptyScreen() {
  screenWallet.classList.add('hidden');
  screenEmpty.classList.remove('hidden');
}

function resetToOverviewTab() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'overview'));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== 'tab-overview'));
}

const KNOWN_HELPER_SERVERS = [
  'https://api1.browsercoin.org',
  'https://api2.browsercoin.org',
  'https://api1.taitech.eu'
];

async function refreshSettings() {
  const settings = await window.brcWallet.getSettings();
  const current = settings.apiBaseUrl || 'https://api1.browsercoin.org';
  el.apiUrl.value = current;
  el.apiUrlSelect.value = KNOWN_HELPER_SERVERS.includes(current) ? current : 'custom';
  el.autoSyncIntervalSelect.value = String(settings.autoSyncIntervalMs || 60000);
  autoSyncIntervalMs = settings.autoSyncIntervalMs || 60000;
  applyTheme(settings.theme || 'dark');
  el.themeSelect.value = settings.theme || 'dark';
  applyAccent(settings.accentColor || null);
  el.accentSelect.value = settings.accentColor || '';
  el.qrColorSelect.value = settings.qrStyle || '';
  el.notificationsToggle.checked = Boolean(settings.notificationsEnabled);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ---- Premium features (unlocked by cumulative donations, no license server) ----

const ACCENT_MAP = {
  '#2f9e5f': 'green',
  '#c53d3d': 'red',
  '#d98c1f': 'amber',
  '#2f8fc5': 'blue',
  '#a83fd0': 'magenta'
};

function applyAccent(hex) {
  const key = hex ? ACCENT_MAP[hex] : null;
  if (key) document.documentElement.setAttribute('data-accent', key);
  else document.documentElement.removeAttribute('data-accent');
}

let premiumStatus = null;

async function refreshPremiumStatus() {
  try {
    premiumStatus = await window.brcWallet.getPremiumStatus();
  } catch (e) {
    return;
  }
  const u = premiumStatus.unlocked;
  const t = premiumStatus.thresholds;

  document.querySelectorAll('.nav-btn[data-feature]').forEach((btn) => {
    const feature = btn.dataset.feature;
    const badge = btn.querySelector('.lock-badge');
    const locked = !u[feature];
    badge.classList.toggle('hidden', !locked);
    if (locked) badge.textContent = `\u{1F512} ${t[feature]}`;
  });

  el.addressbookLocked.classList.toggle('hidden', u.addressBook);
  el.addressbookUnlocked.classList.toggle('hidden', !u.addressBook);
  if (!u.addressBook) {
    el.addressbookLocked.querySelector('.muted').textContent =
      `Donate ${t.addressBook} BRC total to unlock the address book. You've donated ${premiumStatus.totalDonatedBrc} BRC so far.`;
  }
  el.btnPickAddress.classList.toggle('hidden', !u.addressBook);

  el.statsLocked.classList.toggle('hidden', u.stats);
  el.statsUnlocked.classList.toggle('hidden', !u.stats);
  if (!u.stats) {
    el.statsLocked.querySelector('.muted').textContent =
      `Donate ${t.stats} BRC total to unlock statistics. You've donated ${premiumStatus.totalDonatedBrc} BRC so far.`;
  }

  el.historySearch.classList.toggle('hidden', !u.search);
  el.historySearchLocked.classList.toggle('hidden', u.search);
  if (!u.search) {
    el.historySearchLocked.textContent = `\u{1F512} Donate ${t.search} BRC total to unlock history search.`;
  }

  el.accentLocked.classList.toggle('hidden', u.themesQr);
  el.accentUnlocked.classList.toggle('hidden', !u.themesQr);
  if (!u.themesQr) {
    el.accentLocked.textContent = `\u{1F512} Donate ${t.themesQr} BRC total to unlock accent colors and QR customization.`;
  }

  el.notificationsLocked.classList.toggle('hidden', u.notifications);
  el.notificationsToggleWrap.classList.toggle('hidden', !u.notifications);
  if (!u.notifications) {
    el.notificationsLocked.textContent = `\u{1F512} Donate ${t.notifications} BRC total to unlock desktop notifications.`;
  }

  const nextLock = Object.entries(t)
    .filter(([key]) => !u[key])
    .sort((a, b) => a[1] - b[1])[0];
  if (nextLock) {
    const remaining = (nextLock[1] - Number(premiumStatus.totalDonatedBrc)).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    el.premiumProgress.textContent = `${premiumStatus.totalDonatedBrc} BRC donated \u2014 ${remaining} more unlocks the next feature`;
  } else {
    el.premiumProgress.textContent = `${premiumStatus.totalDonatedBrc} BRC donated \u2014 everything unlocked, thank you!`;
  }
}

async function refreshHistory() {
  try {
    const history = await window.brcWallet.getHistory();
    renderHistory(history);
  } catch (e) {
    // Non-fatal -- the balance/sync flow already surfaces real errors.
  }
}

function renderHistory(history, isFiltered = false) {
  if (!isFiltered) lastRenderedHistory = history || [];
  if (!history || history.length === 0) {
    el.historyList.replaceChildren(h('div', { text: isFiltered ? 'No matching transactions.' : 'No transactions yet.', className: 'muted small-text' }));
    return;
  }
  const entries = [...history].reverse().map((entry) => {
    const label = entry.type === 'sent' ? 'Sent' : entry.type === 'received' ? 'Received' : 'Mined';
    const sign = entry.type === 'sent' ? '-' : '+';
    const counterpartyText = entry.counterparty
      ? (entry.type === 'sent' ? `to ${shortAddr(entry.counterparty)}` : `from ${shortAddr(entry.counterparty)}`)
      : 'block reward';
    return h('div', { className: 'history-entry', onClick: () => showTransactionDetail(entry) }, [
      h('div', { className: 'hleft' }, [
        h('span', { text: label, className: `htype ${entry.type}` }),
        h('span', { text: counterpartyText, className: 'hmeta' })
      ]),
      h('div', { className: 'hright' }, [
        h('span', { text: `${sign}${weiToBrcShort(entry.amountWei)} BRC`, className: 'hamount' }),
        h('div', { text: `block ${entry.height}`, className: 'hmeta' })
      ])
    ]);
  });
  el.historyList.replaceChildren(...entries);
}

function detailRow(label, value, copyable) {
  const valueNode = h('div', { text: value, className: 'dvalue' });
  const children = [h('div', { text: label, className: 'dlabel' }), valueNode];
  if (copyable) {
    children.push(h('button', {
      text: 'Copy', className: 'small',
      onClick: () => navigator.clipboard.writeText(value)
    }));
  }
  return h('div', { className: 'detail-row' }, children);
}

function showTransactionDetail(entry) {
  const label = entry.type === 'sent' ? 'Sent' : entry.type === 'received' ? 'Received' : 'Mined';
  const rows = [
    detailRow('Type', label),
    detailRow('Amount', `${weiToBrcDisplay(entry.amountWei)} BRC`)
  ];
  if (entry.feeWei && entry.feeWei !== '0') rows.push(detailRow('Fee', `${weiToBrcDisplay(entry.feeWei)} BRC`));
  if (entry.counterparty) rows.push(detailRow(entry.type === 'sent' ? 'To' : 'From', entry.counterparty, true));
  rows.push(detailRow('Block height', String(entry.height)));
  rows.push(detailRow('Date', formatDate(entry.timestamp)));
  if (entry.txid) rows.push(detailRow('Transaction ID', entry.txid, true));
  showInfo('Transaction detail', () => rows);
}

async function init() {
  await refreshSettings();
  setupTabs();
  refreshAppVersion();
  try {
    const res = await window.brcWallet.tryAutoLoad();
    if (res && res.needsPassword) {
      await handleEncryptedUnlock();
    } else if (res) {
      showWalletScreen(res.address);
    }
  } catch (e) {
    // Fall through to the empty screen -- nothing to auto-load.
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `tab-${target}`);
      });
      collapseSidebar();
      if (target === 'history') refreshHistory();
      if (target === 'addressbook') refreshAddressBook();
      if (target === 'stats') refreshStats();
    });
  });

  el.sidebarToggle.addEventListener('click', () => {
    el.sidebar.classList.toggle('expanded');
  });

  document.addEventListener('click', (e) => {
    if (
      el.sidebar.classList.contains('expanded') &&
      !el.sidebar.contains(e.target) &&
      !el.sidebarToggle.contains(e.target)
    ) {
      collapseSidebar();
    }
  });
}

function collapseSidebar() {
  el.sidebar.classList.remove('expanded');
}

// ---- Wallet creation / import / export ----

// ---- Address book (premium: 10 BRC) ----

async function refreshAddressBook() {
  if (!premiumStatus || !premiumStatus.unlocked.addressBook) return;
  try {
    const list = await window.brcWallet.listAddressBook();
    renderAddressBook(list);
  } catch (e) {
    // Non-fatal.
  }
}

function renderAddressBook(list) {
  if (!list || list.length === 0) {
    el.addressbookList.replaceChildren(h('div', { text: 'No saved addresses yet.', className: 'muted small-text' }));
    return;
  }
  const rows = list.map((entry) => {
    const info = h('div', {}, [
      h('div', { text: entry.name, className: 'ab-name' }),
      h('div', { text: shortAddr(entry.address), className: 'ab-addr' })
    ]);
    const renameBtn = h('button', {
      text: '\u270E', className: 'small', title: 'Rename',
      onClick: async () => {
        const newName = await openModal({
          title: 'Rename entry',
          buildMessage: () => `Current name: ${entry.name}`,
          showInput: true,
          inputType: 'text'
        });
        if (newName === null || newName.trim() === '') return;
        try {
          const updated = await window.brcWallet.renameAddressBookEntry(entry.address, newName.trim());
          renderAddressBook(updated);
        } catch (e) {
          alert(e.message);
        }
      }
    });
    const removeBtn = h('button', {
      text: '\u2715', className: 'small', title: 'Remove',
      onClick: async () => {
        const updated = await window.brcWallet.removeAddressBookEntry(entry.address);
        renderAddressBook(updated);
      }
    });
    return h('div', { className: 'ab-row' }, [info, renameBtn, removeBtn]);
  });
  el.addressbookList.replaceChildren(...rows);
}

el.btnAbAdd.addEventListener('click', async () => {
  const name = el.abName.value.trim();
  const address = el.abAddress.value.trim().toLowerCase();
  if (!name) {
    alert('Enter a name');
    return;
  }
  if (!ADDRESS_RE.test(address)) {
    alert('Invalid address (64 hex characters expected)');
    return;
  }
  try {
    const list = await window.brcWallet.addAddressBookEntry(name, address);
    renderAddressBook(list);
    el.abName.value = '';
    el.abAddress.value = '';
  } catch (e) {
    alert(e.message);
  }
});

el.btnPickAddress.addEventListener('click', async () => {
  const list = await window.brcWallet.listAddressBook();
  if (list.length === 0) {
    alert('Your address book is empty. Add an entry from the Address book tab first.');
    return;
  }
  const rows = list.map((entry) =>
    h('div', { className: 'wallet-row-info', onClick: () => {
      el.sendTo.value = entry.address;
      modal.cancel.click(); // closes via the modal's own cleanup path, not a manual hide
    } }, [
      h('div', { text: entry.name, className: 'wallet-label' }),
      h('div', { text: shortAddr(entry.address), className: 'wallet-row-addr' })
    ])
  );
  await openModal({
    title: 'Choose an address',
    buildMessage: () => rows,
    showInput: false,
    hideCancel: false,
    okLabel: 'Close'
  });
});

// ---- Statistics (premium: 50 BRC) ----

async function refreshStats() {
  if (!premiumStatus || !premiumStatus.unlocked.stats) return;
  try {
    const history = await window.brcWallet.getHistory();
    renderStats(history);
  } catch (e) {
    // Non-fatal.
  }
}

function renderStats(history) {
  if (!history || history.length === 0) {
    el.statsContent.replaceChildren(h('div', { text: 'No transactions yet.', className: 'muted small-text' }));
    return;
  }
  let receivedWei = 0n;
  let sentWei = 0n;
  let minedWei = 0n;
  let receivedCount = 0;
  let sentCount = 0;
  let minedCount = 0;
  let largestWei = 0n;

  for (const entry of history) {
    const amt = BigInt(entry.amountWei);
    if (amt > largestWei) largestWei = amt;
    if (entry.type === 'received') { receivedWei += amt; receivedCount++; }
    else if (entry.type === 'sent') { sentWei += amt; sentCount++; }
    else if (entry.type === 'mined') { minedWei += amt; minedCount++; }
  }

  const rows = [
    ['Total received', `${weiToBrcDisplay(receivedWei.toString())} BRC (${receivedCount} tx)`],
    ['Total sent', `${weiToBrcDisplay(sentWei.toString())} BRC (${sentCount} tx)`],
    ['Total mined', `${weiToBrcDisplay(minedWei.toString())} BRC (${minedCount} tx)`],
    ['Largest transaction', `${weiToBrcDisplay(largestWei.toString())} BRC`],
    ['Total transactions', String(history.length)]
  ].map(([label, value]) => h('div', { className: 'stat-row' }, [
    h('span', { text: label, className: 'stat-label' }),
    h('span', { text: value, className: 'stat-value' })
  ]));

  el.statsContent.replaceChildren(...rows);
}

// ---- History search (premium: 20 BRC) ----

let lastRenderedHistory = [];

el.historySearch.addEventListener('input', () => {
  const query = el.historySearch.value.trim().toLowerCase();
  if (!query) {
    renderHistory(lastRenderedHistory);
    return;
  }
  const filtered = lastRenderedHistory.filter((entry) => {
    if (['sent', 'received', 'mined'].includes(query) && entry.type === query) return true;
    return entry.counterparty && entry.counterparty.toLowerCase().includes(query);
  });
  renderHistory(filtered, true);
});

document.getElementById('btn-create').addEventListener('click', async () => {
  const res = await window.brcWallet.createWallet();
  showWalletScreen(res.address);
});

document.getElementById('btn-import').addEventListener('click', async () => {
  try {
    const res = await window.brcWallet.importWallet();
    if (!res) return; // dialog canceled
    if (res.needsPassword) {
      await handleEncryptedUnlock();
      return;
    }
    showWalletScreen(res.address);
  } catch (e) {
    alert(`Import failed: ${e.message}`);
  }
});

async function handleEncryptedUnlock() {
  const password = await askPassword('Encrypted wallet', 'Enter the password to decrypt this file.');
  if (password === null) return; // canceled
  try {
    const res = await window.brcWallet.unlockWallet(password);
    showWalletScreen(res.address);
  } catch (e) {
    alert(e.message);
    handleEncryptedUnlock();
  }
}

document.getElementById('btn-export').addEventListener('click', async () => {
  const password = await askPassword(
    'Encrypt the export?',
    'Password to encrypt the exported file (min. 8 characters). ' +
    'Leave blank to export without encryption (private key in plain text — ' +
    'not recommended, except to re-import into browsercoin.org).'
  );
  if (password === null) return; // canceled
  try {
    const filePath = await window.brcWallet.exportWallet(password || undefined);
    if (filePath) alert(`Wallet exported to:\n${filePath}`);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  }
});

document.getElementById('btn-copy-address').addEventListener('click', () => {
  navigator.clipboard.writeText(el.address.textContent);
});

document.getElementById('btn-toggle-qr').addEventListener('click', async () => {
  const showing = !el.qrWrap.classList.contains('hidden');
  if (showing) {
    el.qrWrap.classList.add('hidden');
    el.btnToggleQr.textContent = 'Show QR';
    return;
  }
  try {
    if (!el.qrImg.src) {
      const settings = await window.brcWallet.getSettings();
      const dataUrl = await window.brcWallet.getAddressQrCode(settings.qrStyle || undefined);
      el.qrImg.src = dataUrl;
    }
    el.qrWrap.classList.remove('hidden');
    el.btnToggleQr.textContent = 'Hide QR';
  } catch (e) {
    alert(`Could not generate QR code: ${e.message}`);
  }
});

// ---- Wallet switcher ----

async function openSwitcher() {
  await renderSwitcher();
  el.switcherOverlay.classList.remove('hidden');
}

function closeSwitcher() {
  el.switcherOverlay.classList.add('hidden');
}

async function renderSwitcher() {
  const [wallets, current] = await Promise.all([
    window.brcWallet.listSavedWallets(),
    window.brcWallet.currentWallet()
  ]);
  const currentAddr = current ? current.address : null;

  if (wallets.length === 0) {
    el.switcherList.replaceChildren(
      h('div', { text: 'No saved wallets yet. Import one or export your current wallet to see it here next time.', className: 'muted small-text' })
    );
    return;
  }

  const rows = wallets.map((w) => {
    const info = h('div', { className: 'wallet-row-info', onClick: () => selectSavedWallet(w) }, [
      h('div', { text: w.label, className: 'wallet-label' }),
      h('div', { text: shortAddr(w.address), className: 'wallet-row-addr' })
    ]);
    const renameBtn = h('button', {
      text: '\u270E', className: 'small', title: 'Rename',
      onClick: (e) => { e.stopPropagation(); renameSavedWallet(w); }
    });
    const removeBtn = h('button', {
      text: '\u2715', className: 'small', title: 'Remove from this list (does not delete the file)',
      onClick: async (e) => {
        e.stopPropagation();
        await window.brcWallet.removeSavedWallet(w.address);
        renderSwitcher();
      }
    });
    return h('div', { className: `wallet-row${w.address === currentAddr ? ' current' : ''}` }, [info, renameBtn, removeBtn]);
  });
  el.switcherList.replaceChildren(...rows);
}

async function selectSavedWallet(w) {
  try {
    const res = await window.brcWallet.switchWallet(w.filePath);
    if (res && res.needsPassword) {
      closeSwitcher();
      await handleEncryptedUnlock();
      return;
    }
    if (res) {
      closeSwitcher();
      showWalletScreen(res.address);
    }
  } catch (e) {
    alert(`Could not open that wallet: ${e.message}`);
  }
}

async function renameSavedWallet(w) {
  const newLabel = await openModal({
    title: 'Rename wallet',
    buildMessage: () => `Current name: ${w.label}`,
    showInput: true,
    inputType: 'text'
  });
  if (newLabel === null || newLabel.trim() === '') return;
  try {
    await window.brcWallet.renameSavedWallet(w.address, newLabel.trim());
    renderSwitcher();
  } catch (e) {
    alert(e.message);
  }
}

el.walletTitle.addEventListener('click', openSwitcher);
el.btnOpenSwitcherEmpty.addEventListener('click', openSwitcher);
el.switcherClose.addEventListener('click', closeSwitcher);
el.switcherImport.addEventListener('click', async () => {
  closeSwitcher();
  document.getElementById('btn-import').click();
});
el.switcherCreate.addEventListener('click', async () => {
  closeSwitcher();
  document.getElementById('btn-create').click();
});

// ---- Sync ----

let autoSyncIntervalMs = 60000;
let autoSyncTimer = null;

let lastKnownBalanceWei = null;

// Matches the minimum fee enforced in main.js's wallet:send handler (152
// wei per docs, since a tx is always exactly 152 bytes at 1 wei/byte).
const MIN_FEE_WEI = 152n;

function brcToWeiLocal(brcStr) {
  const [whole, frac = ''] = brcStr.split('.');
  const fracPadded = (frac + '00000000').slice(0, 8);
  return BigInt(whole || '0') * COIN + BigInt(fracPadded || '0');
}

function computeMaxSendableBrc(feeWei) {
  if (lastKnownBalanceWei === null) return null;
  const balance = BigInt(lastKnownBalanceWei);
  const max = balance - feeWei;
  if (max <= 0n) return null;
  return weiToBrcDisplay(max.toString());
}

async function runSync() {
  if (el.btnSync.disabled) return; // a sync (manual or auto) is already running
  el.btnSync.disabled = true;
  el.syncStatus.textContent = 'Syncing...';
  try {
    const res = await window.brcWallet.sync();
    el.balance.textContent = `${res.balanceBrc} BRC`;
    el.syncStatus.textContent = `Block ${res.syncedHeight} / ${res.tipHeight} · nonce ${res.nonce}`;
    renderHistory(res.history);
    lastKnownBalanceWei = res.balanceWei;
    refreshPremiumStatus();
  } catch (e) {
    el.syncStatus.textContent = `Error: ${e.message}`;
  } finally {
    el.btnSync.disabled = false;
  }
}

function startAutoSync() {
  stopAutoSync();
  if (el.autoSyncToggle.checked) {
    runSync(); // sync right away instead of waiting for the first interval tick
    autoSyncTimer = setInterval(runSync, autoSyncIntervalMs);
  }
}

function stopAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

document.getElementById('btn-sync').addEventListener('click', runSync);

el.autoSyncToggle.addEventListener('change', startAutoSync);

el.autoSyncIntervalSelect.addEventListener('change', async () => {
  const ms = Number(el.autoSyncIntervalSelect.value);
  try {
    await window.brcWallet.setAutoSyncInterval(ms);
    autoSyncIntervalMs = ms;
    startAutoSync(); // restart with the new interval
  } catch (e) {
    alert(e.message);
  }
});

window.brcWallet.onSyncProgress((progress) => {
  el.syncStatus.textContent = `Syncing: block ${progress.height} / ${progress.target}`;
});

// ---- Send (with confirmation, no innerHTML) ----

document.getElementById('btn-send-all').addEventListener('click', () => {
  const feeInput = el.sendFee.value.trim();
  if (feeInput && !AMOUNT_RE.test(feeInput)) {
    el.sendResult.textContent = 'Invalid fee (e.g. 0.00000152, max 8 decimals)';
    el.sendResult.className = 'small-text err';
    return;
  }
  const feeWei = feeInput ? brcToWeiLocal(feeInput) : MIN_FEE_WEI;
  const max = computeMaxSendableBrc(feeWei);
  if (max === null) {
    el.sendResult.textContent = lastKnownBalanceWei === null
      ? 'Sync first so the app knows your exact balance.'
      : 'Balance is too low to cover this fee.';
    el.sendResult.className = 'small-text err';
    return;
  }
  el.sendAmount.value = max;
  el.sendResult.textContent = '';
});

el.btnSend.addEventListener('click', async () => {
  const to = el.sendTo.value.trim().toLowerCase();
  const amount = el.sendAmount.value.trim();
  const fee = el.sendFee.value.trim();

  if (!ADDRESS_RE.test(to)) {
    el.sendResult.textContent = 'Invalid recipient address (64 hex characters expected)';
    el.sendResult.className = 'small-text err';
    return;
  }
  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    el.sendResult.textContent = 'Invalid amount (e.g. 1.5, max 8 decimals)';
    el.sendResult.className = 'small-text err';
    return;
  }
  if (fee && !AMOUNT_RE.test(fee)) {
    el.sendResult.textContent = 'Invalid fee (e.g. 0.00000152, max 8 decimals)';
    el.sendResult.className = 'small-text err';
    return;
  }

  const confirmed = await confirmAction(
    'Confirm send',
    () => [
      h('div', {}, [
        h('span', { text: 'Send ' }),
        h('span', { text: `${amount} BRC`, className: 'kv' }),
        h('span', { text: ' to:' })
      ]),
      h('div', { text: to, className: 'kv address-block' }),
      h('div', {}, [
        h('span', { text: 'Fee: ' }),
        h('span', { text: `${fee || '0.00000152 (minimum)'} BRC`, className: 'kv' })
      ]),
      h('div', {
        text: 'Addresses have no checksum on this network — a single wrong ' +
          'character sends funds to a different or non-existent address, ' +
          'unrecoverably. Double-check every character. This action is irreversible.',
        className: 'warn-text'
      })
    ],
    'Send'
  );
  if (!confirmed) return;

  el.btnSend.disabled = true;
  el.sendResult.textContent = 'Sending...';
  el.sendResult.className = 'small-text';
  try {
    const res = await window.brcWallet.send({ to, amountBrc: amount, feeBrc: fee });
    el.sendResult.textContent = `Sent. TXID: ${res.txid}`;
    el.sendResult.className = 'small-text ok';
    el.sendTo.value = '';
    el.sendAmount.value = '';
    el.sendFee.value = '';
  } catch (e) {
    el.sendResult.textContent = `Error: ${e.message}`;
    el.sendResult.className = 'small-text err';
  } finally {
    el.btnSend.disabled = false;
  }
});

document.getElementById('btn-donate').addEventListener('click', async () => {
  if (!ADDRESS_RE.test(DONATION_ADDRESS)) {
    alert('Donation address not configured yet.');
    return;
  }

  const amount = await openModal({
    title: '\u2615 Support this project',
    buildMessage: () => [
      h('div', { text: 'This will send BRC to the developer\u2019s address:' }),
      h('div', { text: DONATION_ADDRESS, className: 'kv address-block' }),
      h('div', { text: 'Amount (BRC)', className: 'modal-input-label' }),
      h('button', {
        text: 'Donate all', className: 'small spaced-above',
        onClick: () => {
          const max = computeMaxSendableBrc(MIN_FEE_WEI);
          if (max === null) {
            alert(lastKnownBalanceWei === null
              ? 'Sync first so the app knows your exact balance.'
              : 'Balance is too low to cover the minimum fee.');
            return;
          }
          modal.input.value = max;
        }
      })
    ],
    showInput: true,
    inputType: 'text',
    okLabel: 'Continue'
  });
  if (amount === null || amount === '') return; // canceled or left empty

  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    alert('Invalid amount (e.g. 1.5, max 8 decimals)');
    return;
  }

  const confirmed = await confirmAction(
    'Confirm donation',
    () => [
      h('div', {}, [
        h('span', { text: 'Send ' }),
        h('span', { text: `${amount} BRC`, className: 'kv' }),
        h('span', { text: ' to the developer:' })
      ]),
      h('div', { text: DONATION_ADDRESS, className: 'kv address-block' }),
      h('div', {
        text: 'This action is irreversible. Thank you! \u2615',
        className: 'warn-text'
      })
    ],
    'Send'
  );
  if (!confirmed) return;

  el.btnDonate.disabled = true;
  el.sendResult.textContent = 'Sending donation...';
  el.sendResult.className = 'small-text';
  try {
    const res = await window.brcWallet.send({ to: DONATION_ADDRESS, amountBrc: amount, feeBrc: '' });
    el.sendResult.textContent = `Sent. TXID: ${res.txid}`;
    el.sendResult.className = 'small-text ok';
  } catch (e) {
    el.sendResult.textContent = `Error: ${e.message}`;
    el.sendResult.className = 'small-text err';
  } finally {
    el.btnDonate.disabled = false;
  }
});

// ---- CSV export ----

el.btnExportCsv.addEventListener('click', async () => {
  try {
    const filePath = await window.brcWallet.exportHistoryCsv();
    if (filePath) alert(`History exported to:\n${filePath}`);
  } catch (e) {
    alert(`Export failed: ${e.message}`);
  }
});

// ---- Settings: helper server ----

el.apiUrlSelect.addEventListener('change', () => {
  if (el.apiUrlSelect.value === 'custom') {
    el.apiUrl.focus();
    return;
  }
  el.apiUrl.value = el.apiUrlSelect.value;
});

document.getElementById('btn-save-url').addEventListener('click', async () => {
  try {
    const saved = await window.brcWallet.setApiBaseUrl(el.apiUrl.value.trim());
    el.apiUrl.value = saved.apiBaseUrl;
    el.apiUrlSelect.value = KNOWN_HELPER_SERVERS.includes(saved.apiBaseUrl) ? saved.apiBaseUrl : 'custom';
    alert('Helper server saved.');
  } catch (e) {
    alert(e.message);
  }
});

// ---- Settings: theme ----

el.themeSelect.addEventListener('change', async () => {
  const theme = el.themeSelect.value;
  applyTheme(theme); // instant feedback
  try {
    await window.brcWallet.setTheme(theme);
  } catch (e) {
    alert(e.message);
  }
});

el.accentSelect.addEventListener('change', async () => {
  const color = el.accentSelect.value || null;
  applyAccent(color); // instant feedback
  try {
    await window.brcWallet.setAccentColor(color);
  } catch (e) {
    alert(e.message);
  }
});

el.qrColorSelect.addEventListener('change', async () => {
  try {
    await window.brcWallet.setQrStyle(el.qrColorSelect.value || null);
    el.qrImg.removeAttribute('src'); // force regeneration with new color next time it's shown
  } catch (e) {
    alert(e.message);
  }
});

el.notificationsToggle.addEventListener('change', async () => {
  try {
    await window.brcWallet.setNotificationsEnabled(el.notificationsToggle.checked);
  } catch (e) {
    alert(e.message);
  }
});

// ---- Settings: version / updates ----

async function refreshAppVersion() {
  const version = await window.brcWallet.getAppVersion();
  el.appVersion.textContent = `Version ${version}`;
}

el.btnCheckUpdate.addEventListener('click', async () => {
  el.btnCheckUpdate.disabled = true;
  el.updateStatus.textContent = 'Checking…';
  el.updateStatus.className = 'small-text';
  try {
    const info = await window.brcWallet.checkUpdate();
    if (info.error) {
      el.updateStatus.textContent = `Could not check for updates: ${info.error}`;
      el.updateStatus.className = 'small-text err';
    } else if (info.hasUpdate) {
      el.updateStatus.replaceChildren();
      const link = h('span', { text: `Version ${info.latestVersion} is available — Download`, className: 'update-link' });
      link.addEventListener('click', () => {
        window.brcWallet.openExternal(info.releaseUrl).catch((e) => alert(e.message));
      });
      el.updateStatus.appendChild(link);
      el.updateStatus.className = 'small-text';
    } else {
      el.updateStatus.textContent = info.message || 'You\u2019re up to date.';
      el.updateStatus.className = 'small-text ok';
    }
  } catch (e) {
    el.updateStatus.textContent = `Could not check for updates: ${e.message}`;
    el.updateStatus.className = 'small-text err';
  } finally {
    el.btnCheckUpdate.disabled = false;
  }
});

init();
