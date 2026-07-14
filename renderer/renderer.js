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
  autoSyncToggle: document.getElementById('auto-sync-toggle')
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

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : '';
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
  for (const child of children) node.appendChild(child);
  return node;
}

// ---- Generic modal (used for password prompts and confirmations) ----

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
function openModal({ title, buildMessage, showInput, inputType = 'password', okLabel = 'OK' }) {
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
    modal.overlay.classList.remove('hidden');
    if (showInput) setTimeout(() => modal.input.focus(), 0);

    function cleanup(result) {
      modal.overlay.classList.add('hidden');
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
  startAutoSync();
}

function resetToOverviewTab() {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'overview'));
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
}

async function refreshHistory() {
  try {
    const history = await window.brcWallet.getHistory();
    renderHistory(history);
  } catch (e) {
    // Non-fatal -- the balance/sync flow already surfaces real errors.
  }
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    el.historyList.replaceChildren(h('div', { text: 'No transactions yet.', className: 'muted small-text' }));
    return;
  }
  const entries = [...history].reverse().map((entry) => {
    const label = entry.type === 'sent' ? 'Sent' : entry.type === 'received' ? 'Received' : 'Mined';
    const sign = entry.type === 'sent' ? '-' : '+';
    const counterpartyText = entry.counterparty
      ? (entry.type === 'sent' ? `to ${shortAddr(entry.counterparty)}` : `from ${shortAddr(entry.counterparty)}`)
      : 'block reward';
    return h('div', { className: 'history-entry' }, [
      h('div', {}, [
        h('span', { text: label, className: `htype ${entry.type}` }),
        h('span', { text: counterpartyText, className: 'hmeta' })
      ]),
      h('div', {}, [
        h('span', { text: `${sign}${weiToBrcDisplay(entry.amountWei)} BRC`, className: 'hamount' }),
        h('div', { text: `block ${entry.height}`, className: 'hmeta' })
      ])
    ]);
  });
  el.historyList.replaceChildren(...entries);
}

async function init() {
  await refreshSettings();
  setupTabs();
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
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== `tab-${target}`);
      });
      if (target === 'history') refreshHistory();
    });
  });
}

// ---- Wallet creation / import / export / lock ----

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
      const dataUrl = await window.brcWallet.getAddressQrCode();
      el.qrImg.src = dataUrl;
    }
    el.qrWrap.classList.remove('hidden');
    el.btnToggleQr.textContent = 'Hide QR';
  } catch (e) {
    alert(`Could not generate QR code: ${e.message}`);
  }
});

// ---- Sync ----

const AUTO_SYNC_INTERVAL_MS = 60000; // matches the ~150s target block time closely
                                       // enough without hammering a shared public
                                       // rate-limited server.
let autoSyncTimer = null;

async function runSync() {
  if (el.btnSync.disabled) return; // a sync (manual or auto) is already running
  el.btnSync.disabled = true;
  el.syncStatus.textContent = 'Syncing...';
  try {
    const res = await window.brcWallet.sync();
    el.balance.textContent = `${res.balanceBrc} BRC`;
    el.syncStatus.textContent = `Block ${res.syncedHeight} / ${res.tipHeight} · nonce ${res.nonce}`;
    renderHistory(res.history);
  } catch (e) {
    el.syncStatus.textContent = `Error: ${e.message}`;
  } finally {
    el.btnSync.disabled = false;
  }
}

function startAutoSync() {
  stopAutoSync();
  if (el.autoSyncToggle.checked) {
    autoSyncTimer = setInterval(runSync, AUTO_SYNC_INTERVAL_MS);
  }
}

function stopAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

document.getElementById('btn-sync').addEventListener('click', runSync);

el.autoSyncToggle.addEventListener('change', startAutoSync);

window.brcWallet.onSyncProgress((progress) => {
  el.syncStatus.textContent = `Syncing: block ${progress.height} / ${progress.target}`;
});

// ---- Send (with confirmation, no innerHTML) ----

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
      h('div', { text: 'Amount (BRC)', className: 'modal-input-label' })
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

init();
