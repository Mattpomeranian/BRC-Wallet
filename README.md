# BRC Wallet

A simple desktop wallet for BrowserCoin (BRC), built with Electron.

## Security audit (v0.3)

A self-audit pass found and fixed the following, in order of severity:

**High**
- **XSS in the send confirmation dialog**: the fee field was interpolated
  unescaped into `innerHTML`. Fixed by rebuilding the entire renderer
  without any `innerHTML` use — all dynamic content goes through
  `textContent` via a small safe DOM-building helper.
- **No chain-continuity check during sync**: a misbehaving helper server
  could serve out-of-order or inconsistent blocks and silently corrupt the
  computed balance. Fixed: `src/sync.js` now verifies each block's height
  is exactly `+1` from the last, and its `prevHash` matches the previously
  accepted block's hash, aborting with a clear error otherwise. (Proof-of-
  work and Merkle-root verification are still out of scope — see below.)
- **Private key lingered in memory indefinitely** with no way to clear it.
  Fixed: the key is now held as a zeroable `Buffer` (not an immutable hex
  string) in the main process, with an explicit **Lock wallet** button that
  overwrites it with zeros. Note: signing and export still briefly
  materialize a hex-string copy of the key — JS gives no way to zero string
  memory, so this is a partial mitigation, not a complete one.

**Medium**
- scrypt cost bumped from N=16384 to **N=131072** (OWASP-recommended
  minimum for a high-value secret), run asynchronously so it doesn't block
  the app.
- Encrypted exports now require an **8-character minimum password**.
- Added a lock to the send handler to prevent a nonce race if the Send
  button is triggered twice in quick succession; the button is also
  disabled while a send is in flight.
- The helper server URL is now validated (must start with `http://` or
  `https://`) before being saved.
- Removed a client-side rule that blocked sending to your own address. That
  rule was never actually backed by the BrowserCoin API docs — it was an
  unverified assumption introduced earlier and is now removed; the network
  is the source of truth for what's a valid transaction.

**Hardening**
- `sandbox: true` added to the Electron window.
- A restrictive Content-Security-Policy (`default-src 'self'`, no inline
  scripts/styles) added to the renderer HTML.
- `decodeBlock` now explicitly rejects a block whose declared transaction
  count doesn't fit the bytes actually received, instead of relying on an
  incidental downstream error.
- Client-side amount/fee validation now uses the exact same regex as the
  signing code, so the confirmation dialog can never show a value that gets
  silently rejected afterwards.
- The send confirmation now explicitly warns that BrowserCoin addresses
  have no checksum — a mistyped character sends funds to a different or
  nonexistent address, unrecoverably. There's no way to fix this at the
  wallet level (it's a protocol property), so the mitigation is making sure
  you actually see the warning before confirming.

## Features (v0.4)

- Create a new wallet (Ed25519 keypair)
- Import / export a wallet in the standard BrowserCoin JSON format
  (`{ type, version, address, privateKeyHex, warning }`) — compatible with
  the browser wallet's export.
- **Encrypted export (recommended)**: on export, an optional password
  encrypts the private key (scrypt + AES-256-GCM) inside the JSON file.
  Leaving the password blank exports in plain text (100% compatible with
  browsercoin.org, but the private key is readable as-is).
- **Send confirmation**: a screen recaps recipient, amount, and fee before
  any transaction is submitted.
- **Transaction history**: sent/received/mined entries are recorded during
  sync (address, amount, block height) and shown in a scrollable list.
- **Address QR code**: generated locally (via the `qrcode` package) and
  shown on demand — nothing is sent over the network to produce it.
- **Auto-load at startup**: the app remembers the last wallet file's path.
  Plain-text files load immediately on launch; encrypted files still prompt
  for the password every time (that gate is never skipped).
- Sync balance and nonce by replaying blocks from a helper server (there's
  no `/balance` endpoint in the API — see below).
- Send BRC to another address (Ed25519 transaction signed locally, submitted
  via `POST /txs`).

## Setup

```bash
npm install
npm start
```

By default the wallet points to `https://api1.browsercoin.org`, one of the
public helper servers listed under Settings → Helper servers on
browsercoin.org. Other known public servers: `https://api2.browsercoin.org`
and `https://api1.taitech.eu`. Change the URL in the "Helper server" panel
of the app if you'd rather point at your own local helper
(`npm run server:api` in the BrowserCoin repo → `http://127.0.0.1:9000`).

## Building a Windows executable

```bash
npm run dist
```

Produces an `.exe` installer (NSIS) in `dist/`.

## How it works

### Transaction wire format (152 bytes)

Taken directly from `docs/developers.md` in the BrowserCoin repo:
`chainId(4) | from(32) | to(32) | amount(8) | fee(8) | nonce(4) | signature(64)`.
The signed preimage is `[0, 88)`; pure Ed25519 (RFC 8032, no prehash).

### Why syncing works by replaying blocks

The helper server API doesn't expose a balance or nonce per address — just
`/tip`, `/blocks`, `/mempool`, `/txs`, `/block`. So to know your balance, the
wallet replays transactions that involve your address from genesis (or from
the last sync point cached locally in `sync-cache/<address>.json`). That's
what `src/sync.js` does.

**Accepted limitation**: this wallet trusts the data returned by the helper
server (it doesn't re-verify proof-of-work or Merkle roots). That's a
reasonable tradeoff for a lightweight send/receive wallet — not a full
validating node. If you want stronger guarantees, query multiple helpers and
compare the balances you get back.

### Key security

The private key never leaves the Electron main process (Node); it's never
sent over the network. It's held as a zeroable `Buffer` and cleared from
memory when you click **Lock wallet**, close the window, or quit the app. If
you export with a password, the file stores the encrypted key (scrypt
N=131072/r=8/p=1 for key derivation, AES-256-GCM for encryption, 8-character
minimum password) — without a password, it's stored in plain text (same
format as the browser wallet). An encrypted export is **not** directly
importable by the browsercoin.org browser wallet, which doesn't know this
format; use the plain-text export for that.

There's no silent auto-unlock: on startup, a remembered plain-text wallet
loads immediately (it was never protected to begin with), but a remembered
encrypted wallet always re-prompts for its password before use. Locking
mid-session works the same way — you'll need to re-enter the password (or
re-import a plain file) to use the wallet again.

## Possible next steps

- **Mining** — on hold pending a design decision. Mining a block requires a
  correct `stateRoot` (account-tree root after the block), and the API docs
  don't specify the exact algorithm used to compute it. A wallet-side miner
  can do fully correct Argon2id proof-of-work, but without matching the
  reference node's exact state-tree construction, submitted blocks would
  likely get rejected by the network even with valid PoW. Needs one of:
  reverse-engineering the reference implementation's state-tree code,
  finding an undocumented endpoint that exposes it, or just linking out to
  an existing separate miner instead of reimplementing one here.
- Auto-lock after a period of inactivity
- Multi-wallet support (switch between several saved wallets without a full
  re-import each time)
