# PagePilot Test Report

**Date:** 2026-07-29
**Prepared by:** automated test battery (for manual owner review)
**Repo path:** `/Users/james.christopher/Documents/PROJECTS/gitpagedeploy`

## Commit state

The working directory is a git repository (`main` branch) with **no commits yet** —
every tracked file (`js/`, `css/`, `index.html`, `sw.js`, `manifest.webmanifest`,
`tools/`, `dist/`, `test/`, `docs/`, etc.) is currently untracked. There is no prior
commit to diff against; this report reflects the on-disk state of the working tree
at the time of the run. `dist/PagePilot.app` and `dist/PagePilot-Installer.dmg` are
present on disk (already built by `tools/build-macos-app.sh`) but `dist/` is not
git-tracked (see `.gitignore`).

## Environment

| Component | Version |
|---|---|
| Node | v24.14.0 |
| npm | 11.9.0 |
| macOS | 26.5 (BuildVersion 25F71, Darwin 25.5.0) |
| Test runner | `node:test` (built-in), no third-party test framework, zero npm deps |

## Executive summary

**Overall verdict: PASS — no bugs found, ready for manual/human sign-off.**

All 95 pre-existing tests pass unchanged. 37 new tests were added across two new
files (`test/redesign.test.js`, `test/macapp.test.js`) to cover the two things this
review was specifically about: the de-tab single-scrolling-view redesign, and the
macOS `.app`/`.dmg` packaging. Full suite: **132 tests / 36 suites / 0 failures / 0
skipped**, running in well under half a second. All module syntax checks pass. The
served app returns 200 for every file it needs (index.html + every entry in the
service worker's precache `SHELL` list). All six PNG icons report the exact
dimensions their filenames promise, and the manifest's icon/shortcut references all
resolve to real files. The macOS bundle's `Info.plist`, executable bit, icon file,
bundled app shell, and installer `.dmg` all check out; the bundled `index.html` is
byte-identical to the repo's `index.html`, so the packaging step has not drifted
from source. No source bugs were found; see "Bugs/risks" below for two
non-blocking, expected-and-documented risks (unsigned app, static-only test
coverage) that are process/scope items rather than defects.

## Results by battery area

| # | Area | What was tested | How | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Existing suite | All 8 pre-existing test files | `npm test` | **PASS** | 95/95 tests, 28 suites, 0 fail, 95.3ms |
| 2 | Syntax | Every ES module in `js/`, `sw.js`, `tools/make-icons.mjs` | `node --input-type=module --check` on each | **PASS** | 9/9 files: `analyze.js`, `app.js`, `deploy.js`, `files.js`, `github.js`, `store.js`, `ui.js`, `sw.js`, `make-icons.mjs` — all clean, no output |
| 3 | Redesign regression (new) | No leftover tab markup; required a11y/PWA wiring intact; app.js section ids present; no dead tab-routing code; CSS Primer tokens present in both light and dark blocks; reduced-motion + focus-visible retained; sw.js VERSION bumped | New file `test/redesign.test.js`, text-only greps/regex against file contents (never imports app.js/ui.js) | **PASS** | 37 new assertions, all green (see "New tests" below) |
| 4 | macOS bundle (new) | `Info.plist` keys, launcher executable bit, `icon.icns` size, `Resources/app` shell completeness, byte-identical `index.html`, `.dmg` validity | New file `test/macapp.test.js`, `plutil -convert json`, `hdiutil imageinfo`, `fs.stat`/`fs.existsSync` — skip-guarded for non-darwin or missing `dist/` | **PASS (ran for real on this machine)** | `CFBundleExecutable=PagePilot`, `CFBundleIconFile=icon`, `LSUIElement=true`; launcher mode has `+x`; `icon.icns` = 55,458 bytes (`ic12` type); `Resources/app/index.html` byte-identical to repo `index.html`; `.dmg` reports `Format: UDZO` |
| 5 | Served-app smoke | `index.html` + all 16 files in sw.js's `SHELL` array | `python3 -m http.server 8901` (own server, port 8080 left untouched), `curl -o /dev/null -w '%{http_code}'` per URL | **PASS** | 17/17 URLs → `200` (`./`, `./index.html`, `./manifest.webmanifest`, `./css/style.css`, 6× `./js/*.js`, 6× `./icons/*`) |
| 6 | Icon integrity | PNG dimensions match filename convention; manifest icon/shortcut references resolve | `file icons/*.png`; cross-checked against `test/pwa.test.js` (already covers manifest→disk existence) | **PASS** | `icon-192.png`=192×192, `icon-512.png`=512×512, `maskable-192.png`=192×192, `maskable-512.png`=512×512, `apple-touch-icon.png`=180×180 (all 8-bit RGBA PNG); `test/pwa.test.js` already asserts every manifest icon and shortcut icon exists on disk — verified still passing |
| 7 | Static accessibility greps | aria-live regions; aria-expanded usage; focus-visible; alt attributes on generated `<img>` | `grep` across `index.html`, `js/*.js`, `css/style.css` (recorded, no new test — findings below) | **PASS (recorded)** | See "Accessibility findings" below |
| 8 | Launcher script sanity | Bash syntax validity of the packaged launcher, without executing it | `bash -n dist/PagePilot.app/Contents/MacOS/PagePilot` | **PASS** | `bash -n` exits 0, no syntax errors; script was **not executed** |

## New tests summary

Two new files, 37 new tests, 0 failures:

- **`test/redesign.test.js`** (26 tests) — text-based only, reads `index.html`,
  `js/app.js`, `css/style.css`, `manifest.webmanifest`, and `sw.js` as plain
  strings; never imports `app.js`/`ui.js` (per scope constraint). Covers:
  - `index.html` has no `class="tabs"` / `data-tab=` markup and exactly one
    `<main id="view">`.
  - `index.html` retains the manifest link, both theme-color metas
    (`#0d1117` dark / `#ffffff` light), `#announcer` (`aria-live="polite"`),
    and `#toasts` (`role="status"`) / `#toasts-alert` (`role="alert"`).
  - `js/app.js` renders `box('project', …)`, `box('checklist', …)`,
    `box('deploy', …)`, `box('health', …)`, `box('settings', …)` (the
    literal ids that become `<section id="…">` via `ui.js`'s `box()` helper),
    registers `./sw.js`, and has no leftover `currentTab` state or `TABS`
    array.
  - Manifest shortcuts (`#deploy`, `#health`) target ids that `app.js`
    actually renders — catches drift between manifest shortcuts and the
    section structure.
  - `css/style.css` defines all six required Primer tokens
    (`--canvas`, `--border-default`, `--fg-default`, `--accent-fg`,
    `--success-emphasis`, `--danger-fg`) in *both* the base `:root` block and
    the `prefers-color-scheme: dark` block (12 assertions), plus
    `prefers-reduced-motion` and `:focus-visible` retention.
  - `sw.js`'s `VERSION` constant is not the original `'pagepilot-v1'`
    (currently `'pagepilot-v2'`).

- **`test/macapp.test.js`** (11 tests) — verifies the packaged `.app`/`.dmg`.
  Guarded with `{ skip }` on `describe()` when not on darwin or when
  `dist/PagePilot.app` is absent, so CI (ubuntu-latest, no `dist/`) skips
  cleanly rather than failing. On this machine it ran for real:
  - `Info.plist` parses via `plutil -convert json` and has
    `CFBundleExecutable=PagePilot`, `CFBundleIconFile=icon`,
    `LSUIElement=true`.
  - Launcher (`Contents/MacOS/PagePilot`) exists and has the executable bit
    set (checked via `fs.statSync().mode`, never executed).
  - `Resources/icon.icns` exists and is > 1KB (actual: 55,458 bytes).
  - `Resources/app/` contains `index.html`, `js/`, `css/`, `icons/`,
    `manifest.webmanifest`, `sw.js`.
  - `Resources/app/index.html` is byte-identical to the repo's `index.html`
    (`Buffer.equals`) — catches packaging drift.
  - `dist/PagePilot-Installer.dmg` exists and `hdiutil imageinfo` reports
    `Format: UDZO`.

`npm test` runs the whole suite including both new files (no separate script
needed — `node --test "test/**/*.test.js"` picks them up automatically).

## Accessibility findings (recorded, no new test)

- **aria-live regions:** `#announcer` (`aria-live="polite"`, `index.html:30`)
  for the single deploy-progress announcer; `#toasts`
  (`aria-live="polite"`, `role="status"`, `index.html:33`) for transient
  toasts; `#toasts-alert` (`role="alert"`, `index.html:34`) for errors; the
  raw deploy log list is deliberately `aria-live="off"` (`js/app.js:551`,
  commented as intentional — it's a verbose raw log, not meant for the
  announcer).
- **aria-expanded:** used on the checklist row toggle (`js/app.js:653`,
  `'aria-expanded': String(open)`), paired with a chevron rotation driven by
  `[aria-expanded="true"]` in `css/style.css:374` — standard disclosure
  pattern.
- **focus-visible:** present and not removed — `css/style.css:159`
  (`.chip`), `:233` (global `button`/`a`/`input`/`[tabindex]`), `:305`
  (`.dropzone`).
- **img alt attributes:** every `<img>`/`h('img', …)` in the app has an
  explicit `alt`. `index.html:20` (brand logo, `alt=""`, decorative — text
  label "PagePilot" sits next to it). `js/app.js:111` (user avatar chip,
  `alt=""`, decorative — the user's login name is rendered as text
  alongside it). No `<img>` calls found in `js/ui.js`. Nothing was found with
  a missing `alt`.

## Bugs / risks found

**No source bugs found.** Two items are worth the owner's attention, but both
are expected scope/process limitations rather than defects:

1. **(Info/low) Unsigned, unnotarized `.app`.** `dist/PagePilot.app` has no
   code signature (not checked by these tests, but implied by the build
   script producing a plain bundle). First launch on a machine other than
   the one it was built on will likely be Gatekeeper-quarantined (the
   "unidentified developer" prompt, or an outright block on newer macOS
   unless the user right-clicks → Open or clears the quarantine xattr). Not
   a code bug — just something the manual reviewer should expect and could
   document in the installer instructions if it isn't already.
2. **(Info/low) Packaging drift has no CI guard.** `test/macapp.test.js`
   only runs when `dist/` already exists (correctly skipped in the
   ubuntu-latest CI workflow at `.github/workflows/test.yml`, since it
   doesn't build or ship `dist/`). That means the byte-identical
   `index.html` check and the other bundle assertions only protect a
   developer who remembers to run the test suite *after* rebuilding the
   `.app` locally — there is no CI job that runs
   `tools/build-macos-app.sh` and then checks the result. Not a bug in this
   review's scope (build tooling is out of bounds), just a gap worth
   flagging.

No other issues were found in the redesign markup, the CSS token migration,
the service worker shell list, the manifest, or the icon set.

## Coverage gaps (being honest)

- **View layer is untested at the DOM/behavior level.** `js/ui.js` and the
  rendering logic in `js/app.js` (the `h()` virtual-DOM helper, `render()`,
  event handlers, checklist disclosure open/close state, toast lifecycle)
  have **no unit or component tests** — only the pre-existing suite's tests
  of `analyze.js`/`deploy.js`/`github.js`/`files.js`/`store.js` (pure
  logic/storage) and this review's new text-based regression tests (which
  deliberately never execute app.js/ui.js, per scope). A real bug in render
  logic, event wiring, or checklist toggle behavior would not be caught by
  anything in this suite.
- **No real-browser E2E.** There is no Playwright/Cypress/Selenium
  coverage — nothing exercises the app in an actual browser DOM, so
  layout, focus movement (`goTo()`'s `scrollIntoView`/`focus()`), drag-and-
  drop, or real service-worker install/activate behavior are unverified.
- **GitHub API is mocked, not live.** `test/github.test.js` and
  `test/deploy.test.js` exercise `js/github.js`'s request plumbing against
  a fake client (`test/helpers/fake-gh.js`); no test in this repo makes a
  real call to api.github.com, so a live-token deploy against a real
  repository is unverified by automation.
- **The macOS `.app` is unsigned** (see risk #1 above) — packaging/signing
  correctness beyond "the bundle has the right shape" is out of scope for
  a file-integrity check.
- **The `.dmg` was verified but never mounted.** Per instructions, `hdiutil
  imageinfo` was used instead of `hdiutil attach`; the DMG's internal
  filesystem contents (i.e., that it actually contains a working copy of
  `PagePilot.app` when mounted) were not inspected.
- **Visual/theme correctness is unverified by automation.** The CSS token
  tests confirm the *tokens exist* in both light and dark blocks, not that
  the rendered UI actually looks correct in either theme.

## Suggested manual checks for the human reviewer

- Open `http://localhost:8080` (the dev server already running) in a real
  browser and eyeball both themes: toggle OS dark/light mode and confirm
  the Primer color tokens render as expected, especially the sticky topbar,
  Box borders, and toast colors.
- Scroll through the single-view page end to end and confirm section jumps
  work: click the "Fix the blockers in the checklist" / "Review the
  checklist" links in the Deploy box and confirm smooth-scroll to
  `#checklist`; open the app with `#deploy` and `#health` hashes (as the
  manifest shortcuts would) and confirm it lands on the right section.
- Expand/collapse a few checklist rows and confirm the chevron rotates and
  `aria-expanded` toggles correctly with a screen reader or the browser's
  accessibility inspector.
- Install `dist/PagePilot.app` on a clean (or different) machine, launch it,
  and confirm Gatekeeper behavior is what's expected/documented (right-click
  → Open, or however it's meant to be distributed).
- Mount `dist/PagePilot-Installer.dmg` (`hdiutil attach`, or just
  double-click it in Finder) and confirm the volume actually contains
  `PagePilot.app` and a drag-to-Applications affordance.
- Do one real deploy with a scratch GitHub token against a throwaway repo:
  confirm the four progress steps (repo → upload → pages → build), the
  success URL panel, and a post-deploy health check against the live site.
- Confirm the service worker actually installs and serves offline on a real
  browser (Application tab → Service Workers → Offline checkbox), since
  `sw.js`'s install/activate/fetch logic is not exercised by any automated
  test here.
