# PagePilot — GitHub Pages Deployer PWA

Drop a folder, get a live GitHub Pages site. PagePilot is an installable Progressive Web App that handles the whole deploy: creates (or updates) the repo, pushes your files as a single commit, enables GitHub Pages, waits for the build, and hands you the canonical URL — plus a readiness checklist and live site health checks.

**Fully client-side.** No server, no build step, no dependencies. Your GitHub token and files never touch anything except `api.github.com`.

Everything lives on **one scrolling page** styled after GitHub's own UI (Primer): Project → Readiness checklist → Deploy → Site health → GitHub connection.

**Docs:** [Quick Start Guide](<Quick Start Guide.md>) · [Engineering handoff](HANDOFF.md) · [Test report](docs/TEST-REPORT.md) · [Design spec](docs/DESIGN-SPEC.md)

## Features

- **Three ways to add a project**: drag-and-drop a folder, browse for one, or open a project path via the File System Access API (Chrome/Edge).
- **Pre-flight analysis & checklist**: index.html at root, GitHub size limits, `.nojekyll`, custom 404, meta description, Open Graph tags, canonical link, favicon, robots.txt, sitemap — each with pass/warn/fail, an explanation of why it matters, and **one-click auto-fixes** (generated `.nojekyll`, `404.html`, `robots.txt`, `sitemap.xml` are added to the deploy).
- **One-click deploy**: repo creation → file upload (single Git commit via the Git Data API) → Pages enablement → build polling, with a live progress log. Existing repos get an explicit "Update site" flow with an overwrite notice.
- **Canonical URL** front and center on success, with copy button.
- **Site health**: Pages build status, HTTPS enforcement, custom domain, last build time, and the live page's title/description/OG/canonical metadata.
- **GitHub auth in Settings**: PAT with show/hide, test connection (avatar + username), and a storage choice — session-only (default) or remembered on this device.
- **Installable & offline-capable**: web manifest + service worker; the app shell works offline and installs on desktop and mobile.

## Install on macOS (drag-and-drop)

```bash
./tools/build-macos-app.sh
open dist/PagePilot-Installer.dmg   # drag PagePilot.app → Applications
```

The `.app` is a native bundle (built with only macOS system tools) that serves the app locally and opens it in an app-mode browser window. First launch: right-click → Open (it's unsigned).

## Setup (any platform)

Any static file server works:

```bash
# from this directory — pick one:
python3 -m http.server 8080
npx serve .
```

Open http://localhost:8080. Service workers require `localhost` or HTTPS.

**Best option: deploy PagePilot with itself.** Serve it locally once, drag this folder into it, and it will publish itself to `https://<you>.github.io/pagepilot/` — from then on use (and install) it from there on any device.

## Configure GitHub access

1. Create a token at **github.com → Settings → Developer settings → Personal access tokens**.
   - **Fine-grained (recommended)**: Contents *read/write*, Pages *read/write*, Administration *read/write* (only needed so PagePilot can create repos), Metadata *read*. Set an expiry.
   - **Classic**: `repo` scope.
2. In the app's **GitHub connection** section: paste the token → **Save & test connection**. Your avatar and username confirm it works.
3. Choose storage: *this session only* (default, safest) or *remember on this device*.

## Install as an app

- **Chrome / Edge (desktop & Android)**: install icon in the address bar, or menu → *Install app*.
- **iOS Safari**: Share → *Add to Home Screen*.
- Once installed it launches standalone, works offline, and updates itself when the hosted version changes.

## Deploy a site

1. **Project** section → drop your project folder (deploy the *build output* — `dist/`, `build/`, `_site/` — for framework projects).
2. Review the **Readiness checklist**; tick the auto-fixes you want.
3. In **Deploy**, name the repo and press **Deploy to GitHub Pages**.
4. Copy your canonical URL. Run a **Site health** check any time.

`node_modules`, `.git`, and OS junk files are excluded automatically. Limits (GitHub's): 100 MB per file, 1 GB per site.

## Development

```bash
npm test                    # node:test suite, zero dependencies
node tools/make-icons.mjs   # regenerate PWA icons
```

Design spec: `docs/DESIGN-SPEC.md`.

## Ideas to make this work better

Near-term, high value:

1. **GitHub OAuth Device Flow** instead of pasted PATs — better security and a much friendlier first run (needs a registered OAuth app; still serverless).
2. **Deploy via GitHub Actions artifact** (`actions/deploy-pages`) — avoids committing build output to a branch and enables build-on-push later.
3. **Diff-aware updates** — compare blob SHAs and upload only changed files; big speedup for repeat deploys of large sites.
4. **Retry-from-failed-step** in the progress log (the design spec defines the UX; the engine already isolates steps).
5. **Custom domain wizard** — write the `CNAME` file, show the exact DNS records, and poll `github.com`'s domain verification.
6. **Share target**: register the PWA as a share target on Android so a zipped site can be shared straight into it (plus zip ingestion).
7. **Org support & repo visibility** — deploy to organizations and choose public/private (Pages on private repos needs a paid plan).
8. **Lighthouse-style deep health checks** — broken-link scan, image weight audit, and a11y checks against the live site.
9. **Background sync notifications** — fire a notification when a slow Pages build finishes while the app is backgrounded.
10. **Encrypted token at rest** — wrap the PAT with a WebAuthn/passkey-derived key so it's not plaintext in localStorage.
