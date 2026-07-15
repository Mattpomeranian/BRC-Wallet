# Maintaining BRC Wallet

Notes for whoever maintains this repo (currently just Matthieu) — not needed to use the app.

## Publishing a release

The in-app **Check for updates** button compares the user's version against this repo's [GitHub Releases](https://github.com/Mattpomeranian/BRC-Wallet/releases). It finds nothing until a release actually exists, and it never downloads or installs anything automatically — it only links to the release page.

To publish one:

1. Bump `"version"` in `package.json` (e.g. `0.4.0` → `0.5.0`).
2. Build the installer:
   ```bash
   npm run dist
   ```
3. Create a GitHub Release with a matching tag (e.g. `v0.5.0` for version `0.5.0` — the check strips a leading `v` before comparing) and attach the built installer from `dist/`.

Via GitHub CLI instead of the web UI:

```bash
gh release create v0.5.0 dist/*.exe --title "v0.5.0" --generate-notes
```
