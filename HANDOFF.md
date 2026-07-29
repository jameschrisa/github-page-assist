# PagePilot — Engineering Handoff

**Date:** 2026-07-29 · **Status:** v1.0, feature-complete, test suite green
**Audience:** any engineer taking over or contributing to this codebase.

## What this is

PagePilot is a fully client-side PWA that deploys a local static folder to GitHub Pages: it creates/updates the repo, pushes the files as one Git commit, enables Pages, polls the build, and reports the canonical URL plus site health. There is **no server, no framework, no build step, and no runtime npm dependency** — plain ES modules served statically. Keep it that way; it is the project's core constraint (portability + auditability of the token path).

## Architecture

```
index.html                 app shell: single scrolling view, sections (GitHub Primer look)
css/style.css              all styling; Primer-style tokens, light/dark via prefers-color-scheme
js/
  app.js                   state + render loop (plain functions returning DOM), section views
  ui.js                    DOM helper h(), toasts (status/alert hosts), aria-live announce(), CopyField button
  store.js                 settings + token storage (localStorage/sessionStorage), recent deploys
  github.js                thin GitHub REST client (fetch, Bearer PAT, typed GitHubError)
  files.js                 ingestion: drag-drop entries, webkitdirectory, File System Access; ignore
                           lists (.git, node_modules…), root-stripping, base64 encoding
  analyze.js               project analysis → checklist items (pass/warn/fail + auto-fix generators)
  deploy.js                orchestration: ensure repo → blobs (6-way pool) → tree → commit → ref
                           → enable Pages → poll build; fetchHealth(); canonicalUrlFor()
sw.js                      service worker: versioned app-shell precache, stale-while-revalidate;
                           never intercepts cross-origin (GitHub API)
manifest.webmanifest       PWA manifest (standalone, shortcuts to #deploy / #health)
icons/                     generated PNGs + favicon.svg
tools/make-icons.mjs       zero-dep PNG icon generator (hand-rolled encoder) — rerun on art changes
tools/build-macos-app.sh   builds dist/PagePilot.app + drag-to-Applications DMG (sips/iconutil/hdiutil only)
test/                      node:test suite (no deps): engine modules + PWA wiring; npm test
docs/DESIGN-SPEC.md        original UX spec (flows, microcopy, AA-verified tokens) — v1 tabbed design;
                           superseded visually by the single-view Primer redesign, still authoritative
                           for flows, microcopy, and a11y rules
.github/workflows/test.yml CI: syntax check + npm test
```

### Data flow of a deploy

1. `files.js` normalizes user input to `[{path, file}]` (root dir stripped, junk ignored).
2. `analyze.js` produces checklist items; items with `fix.generate()` can inject generated files.
3. `deploy.js#deploy()` — steps emit `onProgress(step, msg, state)` with step ids
   `repo | upload | commit | pages | build` (UI folds `commit` into the upload row).
   New repos are created with `auto_init`, then the snapshot is committed as a **fresh tree**
   (deploy = exact mirror of the dropped folder; deletions propagate) and the ref is force-updated.
4. Pages enablement: `POST /pages` (409 → already enabled → `GET /pages`), then poll
   `pages/builds/latest` (20 × 3 s), then surface `html_url` as the canonical URL.

### State & security decisions

- PAT lives in `sessionStorage` (default) or `localStorage` (opt-in), sent only to `api.github.com`. No encryption at rest — deliberate; documented to the user in-app. An upgrade path (WebAuthn-wrapped key) is in the README ideas list.
- `state` in app.js is a single mutable object + full re-render on change. Fine at this size; if it grows, introduce per-section render before reaching for a framework.
- Accessibility invariants: one visually-hidden `#announcer` (`aria-live=polite`) for progress, toast hosts split into `role=status` / `role=alert`, checklist rows are `button[aria-expanded]`, focus outlines never removed, `prefers-reduced-motion` zeroes animation.

## Build & release

- **Web**: no build. Bump `VERSION` in `sw.js` on every release (cache invalidation).
- **Mac**: `./tools/build-macos-app.sh` → `dist/PagePilot.app` + `dist/PagePilot-Installer.dmg`. The .app is a native bundle whose launcher serves the bundled files on `127.0.0.1:8417+` (python3 http.server) and opens a Chromium `--app` window (falls back to default browser). Unsigned: first launch needs right-click → Open. Signing/notarization (`codesign`, `notarytool`) is the obvious next step if distributing beyond the team.
- **Self-hosting**: the app can deploy itself to GitHub Pages; that hosted copy is the best cross-device install source.

## Tests

`npm test` → node:test, zero dependencies, ~100 ms. Coverage: files/analyze/deploy/store/github units (fake GitHub client, DOMParser stub, in-memory storage) + PWA wiring assertions (manifest fields, icons exist, sw SHELL entries exist on disk, index.html/manifest/theme-color/sw-registration references). The view layer (app.js/ui.js) is intentionally untested at the unit level — it's DOM-render code; a Playwright smoke suite is the next investment if regressions appear there.

Latest full battery + results for manual review: `docs/TEST-REPORT.md`.

## Known limitations / gotchas

- **Deploys replace repo contents** (fresh tree, force ref update) — by design, warned in UI ("Update site… replaces its contents"). Don't point it at a repo whose history matters without understanding this. History is preserved (commits chain), but the working tree mirrors the upload.
- Pages API on private repos requires a paid plan; fine-grained tokens need Administration r/w only for repo *creation*.
- `latestPagesBuild` 404s on brand-new sites until the first build lands; deploy() treats a never-resolving poll as "still building" (looks identical to a real slow build).
- File System Access picker is Chromium-only; Safari/Firefox fall back to `webkitdirectory` / multi-file input automatically.
- The Mac launcher requires `python3` on PATH (ships with Command Line Tools on modern macOS).
- Browsers can't read a filesystem path from a text input — "project path" is implemented as the native directory picker; that's the platform ceiling.

## Roadmap (agreed, ordered)

1. GitHub OAuth Device Flow (replaces pasted PATs).
2. Deploy via Actions artifact (`actions/deploy-pages`) instead of branch commits.
3. Diff-aware uploads (compare blob SHAs; only push changes).
4. Retry-from-failed-step surfaced in the progress UI (engine already step-isolated).
5. Custom-domain wizard (CNAME + DNS instructions + verification polling).
6. Playwright E2E smoke suite; code signing for the Mac bundle.
