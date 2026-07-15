# BRC Wallet

A simple desktop wallet for [BrowserCoin](https://browsercoin.org) (BRC) — send, receive, and manage your BRC without opening a browser tab.

platform: Windows · macOS · Linux (Electron) · license: MIT

> **⚠️ Experimental software — use at your own risk.** This is an independent,
> unofficial wallet built for an experimental cryptocurrency with no fiat
> market and no guaranteed value. It has not been professionally audited.
> Don't rely on it for anything you can't afford to lose, and don't store
> more than "fun money" amounts in it. Always keep a backup of your wallet
> file (see [Backing up your wallet](#backing-up-your-wallet)) — if you lose
> both the file and its private key, the funds are gone permanently, with no
> recovery possible.

## Why

BrowserCoin's own wallet lives in a browser tab and needs a JSON file for backup/restore. BRC Wallet gives you the same address and keys in a standalone desktop app: create or import a wallet, check your balance, and send BRC — all without a browser open.

Your private key never leaves your machine and is never sent anywhere. This app talks to the same open, public BrowserCoin API that the browser client uses — there's no separate backend, no account, no login.

## Features

- **Create or import** a wallet — fully compatible with the standard BrowserCoin wallet JSON format
- **Multiple wallets** — click the app title to switch between saved wallets or rename them
- **Encrypted export** — optionally password-protect the exported file (scrypt + AES-256-GCM)
- **Send BRC** with a clear confirmation screen before anything is submitted
- **Transaction history** — sent, received, and mined entries, synced from the chain; click any entry for full details, or export the whole history to CSV
- **Address QR code** for easy sharing
- **Auto-sync** on a configurable interval (30s to 5min), plus manual sync on demand
- **Multiple helper servers** — switch instantly from a dropdown if one is down
- **Auto-load at startup** — remembers your last wallet; encrypted wallets still always ask for the password
- **Light and dark theme**
- **Update check** against this repo's GitHub releases
- **Premium features, unlocked by donating** — address book, history search, desktop notifications, custom accent colors + QR styling, and statistics unlock progressively based on how much you've donated in total (tracked automatically from your own synced history, no license server or account involved)

## Getting started

You'll need [Node.js](https://nodejs.org) 18 or later installed first.

```bash
git clone https://github.com/Mattpomeranian/BRC-Wallet.git
cd BRC-Wallet
npm install
npm start
```

That's it — the app opens and you can create a new wallet or import an existing one.

## Using the wallet

**Overview** — your address (with QR code), balance, and sync button.

**Send** — enter a recipient address and amount. You'll see a confirmation screen with the full details before anything is sent. BrowserCoin addresses have no checksum, so double-check the address carefully — a single wrong character sends funds to a different (or nonexistent) address, unrecoverably.

**History** — a running log of your sent, received, and mined transactions, updated on every sync. Click any entry to see its full details (TXID, addresses, exact amounts) with copy buttons, or use **Export CSV** to save the whole history to a spreadsheet.

**Settings** — pick a helper server from the dropdown (or enter a custom one). If a server is down, just switch to another and hit Save. Also: auto-sync interval, light/dark theme, and a manual update check against this repo's GitHub releases.

### Switching between wallets

Click the app title ("BRC Wallet") at the top to open the wallet switcher. It lists every wallet you've imported or exported so far — click one to switch to it (encrypted ones still ask for their password), rename it with the pencil icon, or remove it from the list (this only forgets it here; it never touches or deletes the actual file).

### Backing up your wallet

Click **Export** on the Overview tab. You can set a password to encrypt the file, or leave it blank to export in plain text (compatible with the browsercoin.org wallet's own import). Either way, treat the exported file like a password — anyone who has it can spend your BRC.

## Building a standalone executable

```bash
npm run dist
```

Produces a Windows installer (`.exe`) in `dist/`. (Requires the `win` build target configured in `package.json`; adjust for macOS/Linux if needed.)

The in-app **Check for updates** button (Settings tab) compares your version against this repo's GitHub Releases and links to the release page if one is newer — it never downloads or installs anything automatically. See [MAINTAINING.md](MAINTAINING.md) for how releases get published.

## Security notes

**Use at your own risk** — this software is provided as-is, with no warranty of any kind (see [License](#license)).

- The private key is held in memory only while the app is running and is cleared when the app closes.
- Wallet files, settings, and the transaction cache are written with restrictive file permissions (owner-only).
- This wallet computes your balance by replaying blocks from a helper server and checking that they form a consistent chain (correct height and linkage) — but it does not independently re-verify proof-of-work or Merkle roots. That's a deliberate tradeoff for a lightweight wallet, not a full validating node.
- This is an experimental cryptocurrency with no fiat market — don't treat BRC as having guaranteed value.

## Troubleshooting

- **"Cannot find module ..." on startup** — run `npm install` again; a dependency was likely added or updated.
- **Sync fails with a 429 error** — the app already retries automatically with backoff, so this only surfaces if every retry is exhausted. Wait a moment, or pick a different helper server from the dropdown in Settings.
- **"No wallet loaded"** — you'll land here on first launch, or if the app couldn't find your last wallet file. Create a new one, import your backup, or click the app title to reopen a wallet from the switcher if you've used it before.
- **"Check for updates" says no releases / rate-limited** — expected until a release is actually published on GitHub (see [MAINTAINING.md](MAINTAINING.md) if you're the maintainer); a rate-limit message means GitHub is temporarily throttling the check, not an app problem — try again shortly.

## Credits

Built for [BrowserCoin](https://browsercoin.org) — [github.com/swompythesecond/BrowserCoin](https://github.com/swompythesecond/BrowserCoin).

## License

MIT
