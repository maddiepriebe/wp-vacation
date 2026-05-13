Placeholder icon directory.

Phase 1 ships without real PNGs — the manifest references these paths so the
plumbing is in place. Drop real assets here before deploying:

- `icon-192.png` — 192×192
- `icon-512.png` — 512×512
- `icon-maskable-512.png` — 512×512, with safe-zone padding
- `apple-touch-icon.png` — 180×180
- `favicon.ico` — multi-size

Until then the browser will request these and 404, which is harmless for
Phase 1 local dev but should be fixed before any installable PWA testing.
