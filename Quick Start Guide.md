# PagePilot — Quick Start Guide

Get from a folder on your Mac to a live GitHub Pages site in about five minutes.

## 1. Install (Mac)

1. Build the installer (once): `./tools/build-macos-app.sh`
2. Open `dist/PagePilot-Installer.dmg`.
3. Drag **PagePilot.app** onto the **Applications** folder alias.
4. First launch only: **right-click → Open** (the app isn't code-signed, macOS asks once).

PagePilot opens as an app window in your browser. Everything runs locally — nothing leaves your Mac except calls to `api.github.com`.

> No Mac? Serve the folder with any static server (`python3 -m http.server 8080`) and install it from the browser (install icon in the address bar, or Share → Add to Home Screen on iOS).

## 2. Connect GitHub (one time)

1. Create a token at **github.com → Settings → Developer settings → Personal access tokens**:
   - **Fine-grained (recommended)**: Contents *read/write*, Pages *read/write*, Administration *read/write*, Metadata *read*. Set an expiry.
   - **Classic**: `repo` scope.
2. In PagePilot, scroll to the **GitHub connection** section, paste the token, click **Save & test connection**. Your avatar and username appear when it works.
3. Storage: *this session only* is the default (safest). Tick *remember on this device* on your personal machine if you deploy often.

## 3. Deploy a site

1. In the **Project** section: drag your site folder in, or click **Choose folder**.
   - Deploying a framework app (Vite, Next, etc.)? Use its **build output** folder (`dist/`, `build/`, `out/`), not the source.
2. Check the **Readiness checklist**. Tick any auto-fixes you want (missing `404.html`, `.nojekyll`, `robots.txt`, `sitemap.xml` can be generated for you).
3. In the **Deploy** section: confirm the repository name, press **Deploy to GitHub Pages**.
4. Watch the four steps run. When it finishes, your **canonical URL** appears — copy it, open it, share it.

Redeploying an update is the same three moves: drop the folder, confirm the name (the button becomes **Update site**), press it.

## 4. Check on your site

The **Site health** section shows the canonical URL, Pages build status, HTTPS enforcement, custom domain, and the live page's title/description/social tags — hit **Check** any time.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "GitHub rejected the token" | Token expired or mistyped — create a new one, re-test the connection. |
| Deploy blocked, "No index.html" | You dropped source code. Build the project and drop the output folder. |
| Site 404s right after deploy | Pages builds take 30–90 s. Re-run Site health in a minute. |
| Underscore folders missing on the live site | Enable the `.nojekyll` auto-fix in the checklist and redeploy. |
| App won't open on first launch | Right-click **PagePilot.app** → **Open** (unsigned-app prompt appears once). |
| Nothing happens on launch | Check that `python3` exists (`xcode-select --install` provides it) and no firewall blocks localhost. |
