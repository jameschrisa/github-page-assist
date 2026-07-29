# PagePilot — UX Design Specification

**Version 1.0 · 2026-07-29 · Status: ready for build**

PagePilot is an installable PWA that deploys a local static project to GitHub Pages. Fully client-side: vanilla HTML/CSS/JS, no build step, no server. The user's GitHub Personal Access Token never leaves the browser except in calls to `api.github.com`.

Design intent in one line: a deploy should feel like sending a message. Pick a folder, name the repo, press Deploy, get a URL.

---

## a. Information architecture and navigation model

### Structure

Four top-level views, one shared context (the "current project" in memory, plus a persisted record of past deploys keyed by repo name):

```
PagePilot
├── Deploy      (home, default view)
├── Checklist   (pre/post-deploy quality checks on the current project)
├── Health      (status of the deployed site; last deploy per repo)
└── Settings    (token, storage choice, security note)
```

Flat IA, no nesting. Deploy is the job; Checklist and Health are lenses on the same project/site; Settings is plumbing. Nothing needs a second nav level.

### Navigation model — decision

**Bottom tab bar below 768px, left icon rail (72px wide, icon + 11px label) at 768px and above.** Same four items, same order, same icons in both.

Why this and not a hamburger or top nav:

1. Four destinations is the sweet spot for a tab bar (3–5 max). No overflow problem now or planned.
2. Installed PWAs on phones live next to native apps. Bottom tabs are the native pattern; a hamburger reads as "website in a wrapper" and hides Checklist and Health, the two views that make PagePilot more than a one-shot uploader.
3. The Deploy view needs every pixel of vertical space on desktop for the dropzone, analysis card, and progress log. A 72px rail costs less than a 56px top bar plus its wasted horizontal middle, and it keeps nav position consistent with mobile muscle memory (left edge ≈ bottom edge, both peripheral).
4. The rail expands to 220px (icon + full label) at 1200px and above. One component, three widths.

Tab items, in order: **Deploy** (paper-plane icon), **Checklist** (checkbox icon), **Health** (pulse icon), **Settings** (gear icon). Icons are inline SVG, 24px, 1.75px stroke, from a single local sprite. Checklist and Health tabs carry a small numeric badge when the current project has failing checks or the last deploy is still building.

Tab state rules:

- Checklist and Health are never disabled. With no project loaded, Checklist shows its empty state; with no deploys recorded, Health shows its empty state. Disabled tabs make the app feel broken on first run.
- Active tab: brand-colored icon + label, 3px indicator (top edge of tab bar item on mobile, left edge of rail item on desktop).
- Tab bar respects `env(safe-area-inset-bottom)`; rail respects `env(safe-area-inset-left)`.
- Keyboard: tabs are a `role="tablist"`-free set of plain links in a `<nav aria-label="Main">`; arrow keys are not required, Tab/Enter is. Each view is a distinct hash route (`#/deploy`, `#/checklist`, `#/health`, `#/settings`) so back/forward and deep links work.

### App header

A slim 48px header sits above the content on every view: app name left, theme follows `prefers-color-scheme` (no manual toggle in v1), and a connection chip on the right showing the authenticated GitHub avatar + username when a token is valid, or a gray "Not connected" chip that links to Settings. The chip is the always-visible answer to "am I signed in?"

---

## b. User flows

### Flow 1 — First run (no token yet)

Design rule: let the user do real work before asking for credentials. Analysis is local, so the token gate appears at the last possible moment, the Deploy button.

```
Install/open app
  → Deploy view (empty state, dropzone + two picker buttons)
  → User adds a project (drag folder / file picker / FS Access directory picker)
  → Analysis runs locally (no token needed)
      • summary card: index.html ✓, 34 files, 2.1 MB, 1 warning
  → User types repo name (pre-filled from folder name, slugified)
  → Presses "Deploy to GitHub Pages"
  → TOKEN GATE: inline panel replaces the button area:
      "Connect GitHub to deploy" + [Open Settings] button
  → Settings view: paste token → Test connection → avatar + username appear
  → "Back to Deploy" button in the success confirmation (also a toast:
      "Connected as @username")
  → Deploy view: project, analysis, and repo name are exactly as left
      (state lives in memory + sessionStorage snapshot)
  → Press Deploy → progress log runs → success state with URL + copy button
  → Post-deploy prompt: "Run the launch checklist" → Checklist view
```

Two rules make this flow survivable: the Deploy view never loses its state when the user detours to Settings, and the token gate names the exact scopes needed before the user leaves for github.com.

### Flow 2 — Repeat deploy (token stored)

```
Open app (token remembered on device)
  → Deploy view; header chip already shows avatar
  → "Recent deploys" list under the dropzone (repo name, URL, time)
  → User drags updated folder
  → Analysis card; repo name pre-filled with last-used repo for a
      matching folder name
  → Repo exists on GitHub → button label switches to "Update site"
      and a one-line notice states contents will be replaced
  → Deploy → progress log (skips "create repo", shows "update repo")
  → Success → URL (unchanged), copy button, "View site" link
```

Target: under 30 seconds from open to deploy started, three interactions (drop, confirm name, press).

### Flow 3 — Failure recovery (applies to both)

Any failed step in the progress log stops the run, marks the step with a fail badge, prints a specific reason and a Retry button that resumes from the failed step, never from the beginning. Uploaded files are tracked, so a retry of "upload files" re-sends only what's missing.

---

## c. Screen-by-screen layouts

All wireframes are mobile width (~375px). Desktop changes are noted per screen. Header and tab bar are omitted after the first wireframe.

### 1. Deploy — empty state (first run)

```
┌─────────────────────────────────┐
│ PagePilot        (Not connected)│  ← header, 48px
├─────────────────────────────────┤
│                                 │
│  Deploy a site                  │  ← page title, 22px
│                                 │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│     ⬆ (folder icon, 32px)      │  ← dropzone, dashed
│  │  Drop your project folder │  │    border, min-height
│     here                        │    200px
│  │                           │  │
│  │  [ Choose folder ]        │  │  ← primary button
│  │  [ Pick files instead ]   │  │  ← ghost button
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                 │
│  Everything runs in your        │  ← 13px, fg-muted
│  browser. Files upload only     │
│  to your own GitHub repo.       │
│                                 │
├─────────────────────────────────┤
│ [Deploy]│[Checklst]│[Health]│[⚙]│  ← tab bar, 56px + safe area
└─────────────────────────────────┘
```

- "Choose folder" uses `showDirectoryPicker()` where available, else a hidden `<input type="file" webkitdirectory>`. "Pick files instead" is a plain multiple-file input for browsers/users that can't hand over a directory. On touch devices (no drag possible) the dropzone renders as a tappable card and "Choose folder" becomes the visual hero.
- Whole dropzone is one button element: focusable, Enter/Space opens the folder picker, 2px focus ring.
- Drag-over state: border goes solid brand, background `brand-subtle`, label swaps to "Drop to analyze".
- Repeat visits add a "Recent deploys" list below the dropzone (repo name, canonical URL, relative time, per-row copy button).

**Desktop (≥768px):** icon rail on the left; content column max-width 640px, centered. Dropzone min-height grows to 260px. Recent deploys sit to the right of the dropzone at ≥1200px in a second 320px column.

### 2. Deploy — project analyzed

```
│  Deploy a site                  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📁 portfolio-site      ✕  │  │  ← project card; ✕ clears
│  │ index.html found      [✓] │  │
│  │ 34 files · 2.1 MB         │  │
│  │ ─────────────────────────  │  │
│  │ ⚠ 2 warnings              │  │  ← expandable disclosure
│  │   ▸ node_modules excluded │  │
│  │     (1,204 files skipped) │  │
│  │   ▸ hero.png is 4.8 MB    │  │
│  └───────────────────────────┘  │
│                                 │
│  Repository name                │  ← label above field
│  ┌───────────────────────────┐  │
│  │ portfolio-site            │  │  ← 44px input, 16px text
│  └───────────────────────────┘  │
│  Will publish to:               │  ← live-updating helper
│  username.github.io/portfolio-  │    line, 13px fg-muted
│  site                           │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Deploy to GitHub Pages   │  │  ← primary, full width,
│  └───────────────────────────┘  │    48px tall
```

- Repo name validates on blur: lowercase letters, digits, hyphens; errors are inline under the field and the helper line hides while an error shows.
- If the token is valid, PagePilot checks repo existence on blur (debounced). Existing repo: helper line adds "This repository already exists. Deploying replaces its contents." and the button relabels to **Update site**.
- No token: pressing the primary button swaps it for the token gate panel (see microcopy §f) rather than a dead disabled state.
- Analysis blockers (no index.html at root) render the summary card in danger styling and disable the Deploy button, with the reason and a fix hint printed where the warnings go.

### 3. Deploy — in progress

```
│  Deploying portfolio-site       │
│                                 │
│  ┌───────────────────────────┐  │
│  │ ✓ Repository created      │  │
│  │ ◐ Uploading files… 21/34  │  │  ← spinner + count
│  │ ○ Enable GitHub Pages     │  │
│  │ ○ Build & publish         │  │
│  └───────────────────────────┘  │
│                                 │
│  ▸ Log                          │  ← collapsed by default
│  ┌───────────────────────────┐  │
│  │ 12:04:11 PUT css/site.css │  │  ← mono 13px, aria-live
│  │ 12:04:12 PUT js/app.js    │  │    ="polite" region,
│  │ …                         │  │    max-height + scroll
│  └───────────────────────────┘  │
│                                 │
│  [ Cancel ]                     │  ← ghost, danger on hover
```

- Four fixed steps: **Create repository** (or "Update repository"), **Upload files** (with n/N counter and a 4px progress bar under the row), **Enable GitHub Pages**, **Build & publish** (polls the Pages build status).
- The step list is the primary display; the verbose log is a disclosure for the curious and for bug reports (a "Copy log" button sits in its header).
- Screen reader behavior: step transitions announce via a single visually-hidden `aria-live="polite"` region ("Uploading files, 21 of 34"), throttled to one announcement per step change or per 25% of upload progress. The raw log is `aria-live="off"` so it never floods.
- Build & publish can take 30–90+ seconds. After 20s the step row adds "GitHub usually takes about a minute. You can leave this view; we'll keep checking." Polling continues across view switches; the Deploy tab shows a spinner badge. If notifications are permitted and the app is backgrounded, fire one on completion.
- Cancel stops future requests, marks remaining steps "canceled", and offers Retry. It states plainly that already-uploaded files stay in the repo.

### 4. Deploy — success

```
│         (check icon, 48px)      │
│      Your site is live          │  ← 22px semibold
│                                 │
│  ┌───────────────────────────┐  │
│  │ https://user.github.io/   │  │  ← CopyField: URL is a
│  │ portfolio-site/     [Copy]│  │    link, 16px, wraps
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │       Open site  ↗        │  │  ← primary
│  └───────────────────────────┘  │
│  [ Run launch checklist ]       │  ← secondary
│  [ Deploy another project ]     │  ← ghost
│                                 │
│  Deployed 34 files in 48s       │  ← 13px fg-muted
```

- The URL is the hero. It renders in the largest text on the screen after the heading, inside a bordered CopyField. Copy button flips to "Copied ✓" for 2s and fires a toast for screen readers.
- "Run launch checklist" carries the deploy context into the Checklist view, which immediately re-checks post-deploy items (HTTPS, canonical) against the live URL.

### 5. Checklist view

```
│  Launch checklist               │
│  portfolio-site · 7 of 10 pass  │  ← summary line
│  ┌───────────────────────────┐  │
│  │ ✓ index.html present      │  │
│  ├───────────────────────────┤  │
│  │ ✕ 404.html          [Fail]│  │  ← tap row to expand
│  │   No custom 404 page.     │  │
│  │   Visitors who hit a bad  │  │
│  │   link see GitHub's       │  │
│  │   default error page.     │  │
│  │   ▸ Why it matters        │  │  ← disclosure
│  ├───────────────────────────┤  │
│  │ ⚠ Meta description  [Warn]│  │
│  ├───────────────────────────┤  │
│  │ ✓ .nojekyll               │  │
│  │ … (10 rows total)         │  │
│  └───────────────────────────┘  │
│  [ Re-run checks ]              │
```

- Ten items, fixed order: index.html, 404.html, .nojekyll, meta description, Open Graph tags, favicon, robots.txt, canonical link tag, HTTPS enforced, custom domain/CNAME. Grouped visually into "Before deploy" (files, checked locally) and "After deploy" (HTTPS, canonical against the live URL); post-deploy rows show a dash badge ("Not deployed yet") until a deploy exists.
- Each row: status badge (pass ✓ green / warn ⚠ amber / fail ✕ red / – gray pending), item name, expandable body with the one-line finding and a "Why it matters" disclosure. Rows are `<button aria-expanded>` headers over a region, keyboard-standard.
- Order within the list is fixed (fails do not jump to the top; stable positions beat re-sorting for repeat users). The summary line carries the count.
- Empty state (no project loaded): centered message + "Go to Deploy" button (copy in §f).

**Desktop:** single 640px column. No two-column layout; a checklist reads top to bottom.

### 6. Health view

```
│  Site health                    │
│  ┌───────────────────────────┐  │
│  │ portfolio-site            │  │  ← repo selector if >1
│  │ https://user.github.io/…  │  │    (native <select>)
│  │                     [Copy]│  │
│  ├───────────────────────────┤  │
│  │ Pages build   ● Built     │  │  ← status rows, badge
│  │ HTTPS         ● Enforced  │  │    right-aligned
│  │ Custom domain – None      │  │
│  │ Last deploy   2h ago      │  │
│  ├───────────────────────────┤  │
│  │ Detected metadata         │  │
│  │ Title: "Jane Doe – Port…" │  │
│  │ Descr: ⚠ missing          │  │
│  │ OG image: ✓ og-image.png  │  │
│  └───────────────────────────┘  │
│  [ Refresh ]   checked 12:41    │
```

- One card per deployed repo; a native select at the top switches repos when more than one deploy is recorded.
- Build status polls the Pages API on view entry and on Refresh; metadata comes from fetching the live page (CORS permitting; when the fetch is blocked, the metadata section states "Couldn't read the live page from this browser" with a "view page source" link instead of pretending).
- Every timestamp is relative with an absolute `title` attribute.

### 7. Settings view

```
│  Settings                       │
│                                 │
│  GitHub access                  │
│  Personal access token          │
│  ┌─────────────────────┬─────┐  │
│  │ ••••••••••••••••••  │ Show│  │  ← 44px, mono when shown
│  └─────────────────────┴─────┘  │
│  Needs: fine-grained token with │  ← 13px help text
│  Contents + Pages read/write on │
│  the repos you'll deploy.       │
│  Create one at github.com →     │
│  Settings → Developer settings  │
│                                 │
│  [ Test connection ]            │  ← secondary button
│  ┌───────────────────────────┐  │
│  │ (avatar) @janedoe      ✓  │  │  ← appears on success
│  └───────────────────────────┘  │
│                                 │
│  Remember token                 │
│  (•) This session only          │  ← radio group,
│  ( ) On this device             │    default = session
│                                 │
│  [ Clear token ]                │  ← ghost, danger text
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🔒 Your token stays in    │  │  ← info panel
│  │ this browser. PagePilot   │  │
│  │ has no server; the token  │  │
│  │ is sent only to           │  │
│  │ api.github.com. "On this  │  │
│  │ device" stores it in      │  │
│  │ local storage, readable   │  │
│  │ by anyone using this      │  │
│  │ browser profile.          │  │
│  └───────────────────────────┘  │
```

- Token field is `type="password"` with a Show/Hide toggle (`aria-pressed`, label swaps). Paste-friendly: no auto-format, trims whitespace on blur. Autocomplete off.
- Test connection: button shows inline spinner + "Testing…", then the avatar/username confirmation card, or an inline error under the field (strings in §f). Success also updates the header chip everywhere.
- Storage default is **session only**. Choosing "On this device" requires no confirm dialog; the security panel directly below carries the disclosure. Switching from device to session wipes the persisted copy immediately.
- Clear token removes it from memory and both storages, resets the header chip, and toasts confirmation.

---

## d. Design tokens

Semantic tokens, one name, two values (light / dark), switched by `prefers-color-scheme`. Every text/background pair below was contrast-checked programmatically against WCAG AA (4.5:1 text, 3:1 UI boundaries); measured ratios shown.

### Color

| Token | Light | Dark | Role / verified contrast |
|---|---|---|---|
| `bg-base` | `#FFFFFF` | `#14171C` | app background |
| `bg-subtle` | `#F6F7F9` | `#1D2127` | cards, log panel, tab bar |
| `bg-muted` | `#ECEEF2` | `#262B33` | hover fills, skeletons |
| `fg-base` | `#1B1F24` | `#E7EAEE` | primary text · 16.6 / 14.9 on bg-base |
| `fg-muted` | `#57606C` | `#9BA3AF` | secondary text · 6.4 / 7.1 on bg-base, ≥5.9 on bg-subtle |
| `border-base` | `#D0D5DC` | `#3A414B` | decorative dividers (not relied on for meaning) |
| `border-input` | `#6E7683` | `#7A828E` | input/control boundaries · 4.6 / 4.6 (≥3:1 req.) |
| `brand-base` | `#1F5EDB` | `#1F5EDB` | filled buttons; white label = 5.7 |
| `brand-hover` | `#1A4FBD` | `#2E6BE8` | button hover; white label = 7.3 / 4.9 |
| `brand-fg` | `#1F5EDB` | `#7AA7FF` | links, active tab, focus ring · 5.7 / 7.5 on bg-base |
| `brand-subtle` | `#E8EFFC` | `#1B2740` | drag-over fill, selected row |
| `success-fg` | `#1A7F37` | `#57C577` | pass badges, success text · 5.1 / 8.3 |
| `success-subtle` | `#E6F5EA` | `#15271C` | pass badge fill (fg on it: 4.5 / 7.2) |
| `warning-fg` | `#8A5A00` | `#D9A13B` | warn badges · 5.9 / 7.8 |
| `warning-subtle` | `#FBF0DC` | `#2A2114` | warn badge fill (5.3 / 6.9) |
| `danger-fg` | `#C22E2E` | `#F17E7E` | fail badges, errors · 5.6 / 6.9 |
| `danger-subtle` | `#FBE9E9` | `#2C1719` | fail badge fill (4.8 / 6.5) |
| `danger-base` | `#C22E2E` | `#C22E2E` | destructive filled button; white label = 5.6 |
| `fg-on-emphasis` | `#FFFFFF` | `#FFFFFF` | text on brand-base / danger-base |

Rules: status colors always pair with an icon or text label, never color alone. Dark mode drops shadows in favor of `border-base` outlines on raised surfaces.

### Spacing

4px base: `4, 8, 12, 16, 24, 32, 48, 64`. Component padding 12–16; card padding 16; section gaps 24; view gutter 16 (mobile), 32 (desktop).

### Radii

`4` badges/chips · `8` buttons, inputs · `12` cards, dropzone, toasts · `9999` avatar, pill counters.

### Type

System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif`. Mono: `ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace`.

| Token | Size/line | Weight | Use |
|---|---|---|---|
| `text-display` | 22/28 | 600 | view titles, success heading |
| `text-title` | 17/24 | 600 | card headings |
| `text-body` | 15/22 | 400 | default UI text |
| `text-input` | 16/24 | 400 | all form inputs (16px stops iOS auto-zoom) |
| `text-small` | 13/18 | 400 | help text, timestamps, tab labels (11px on rail) |
| `text-mono` | 13/20 | 400 | progress log, token when revealed, URLs in log |

Numbers in counters and file sizes use `font-variant-numeric: tabular-nums`.

### Motion

Durations `fast 150ms` (hover, badge swap), `base 200ms` (view fade, disclosure), `slow 400ms` (success check draw). Easing `ease-out` for entrances, `ease-in-out` for moves. All animation wrapped in `@media (prefers-reduced-motion: no-preference)`; reduced motion gets instant state changes and a static check icon.

### Focus

Global: `outline: 2px solid var(--brand-fg); outline-offset: 2px;` on `:focus-visible`. Never removed, never replaced with box-shadow alone.

---

## e. Component inventory

| Component | Anatomy | States | Variants / sizes |
|---|---|---|---|
| **Button** | container, optional 16px leading icon, 500-weight label, spinner replaces icon when loading | default, hover, focus, active, disabled, loading | primary (filled brand), secondary (border-input outline), ghost (no fill), destructive (filled danger) · md 40px, lg 48px (mobile primary actions) · min touch target 44px via padding |
| **TextInput** | label above, 44px field, help text below; error text replaces help text; optional trailing button slot (Show/Hide, Copy) | default, focus, disabled, error, read-only | text, password (reveal toggle), with-trailing-action |
| **Dropzone** | dashed 2px `border-input` container, icon, primary line, embedded buttons | idle, drag-over (solid brand border + `brand-subtle` fill), focus, disabled (during deploy), error flash on rejected drop | full (empty view) / compact 96px strip (when a project is already loaded, for re-drops) |
| **ProjectCard** | folder icon, name, clear ✕, stat line, warnings disclosure | ok, warnings, blocked (danger border + reason) | — |
| **ProgressLog** | step list (icon, label, detail slot, 4px progress bar) + collapsible mono log with Copy log | per step: pending ○, active ◐ (spinner), done ✓, failed ✕, canceled –; whole component: running, complete, failed, canceled | — |
| **StatusBadge** | 20px pill: icon + 13px label on subtle fill | pass, warn, fail, pending (gray dash), info (brand) | with/without label (icon-only gets `aria-label` + tooltip) |
| **CopyField** | bordered row: mono/link value + Copy button | default, copied (2s ✓), focus | url (value is an `<a>`), text |
| **Toast** | bottom-center card (above tab bar), icon, 15px message, optional action link, auto-dismiss 5s (persistent for errors) | info, success, error | rendered into `role="status"` (info/success) or `role="alert"` (error); max one visible, queued |
| **ChecklistRow** | `<button aria-expanded>` header (badge, name, chevron) + body (finding, Why-it-matters disclosure) | collapsed, expanded, pass/warn/fail/pending | — |
| **ConnectionChip** | 24px avatar + @username, or gray dot + "Not connected" | connected, not-connected, checking (spinner) | header only |
| **TabBar / NavRail** | 4 nav links: 24px icon, label, optional count badge, active indicator | default, hover, focus, active, badged | bottom bar <768px · 72px rail ≥768px · 220px rail ≥1200px |
| **InfoPanel** | `bg-subtle` card, lock/info icon, 13px body | static | info, security |

No modals in v1. Confirmations happen inline (overwrite notice, token gate) where the user is already looking; sheets and dialogs are reserved for a future need.

---

## f. Microcopy — paste-ready strings

### Dropzone / project intake

| Key | String |
|---|---|
| `drop.idle.title` | Drop your project folder here |
| `drop.idle.buttons` | Choose folder · Pick files instead |
| `drop.idle.touch` | Add your project folder |
| `drop.active` | Drop to analyze |
| `drop.privacy` | Everything runs in your browser. Files upload only to your own GitHub repo. |
| `drop.rejected` | That looks like a single file. Drop the whole project folder, or use "Pick files instead." |
| `drop.unsupported` | This browser can't open folders directly. Use "Pick files instead" to select your project files. |
| `analyze.progress` | Reading files… {n} found |

### Analysis results

| Key | String |
|---|---|
| `analysis.ok` | index.html found · {n} files · {size} |
| `analysis.warn.excluded` | {folder} excluded ({n} files skipped). Build tools and git internals don't belong on Pages. |
| `analysis.warn.bigfile` | {name} is {size}. Files over 25 MB will fail to upload. |
| `analysis.warn.deepindex` | index.html found in /{dir}, not the root. Your site would live at /{dir}/. Deploy the folder that contains index.html. |
| `analysis.block.noindex` | No index.html in this folder. GitHub Pages needs one at the root to serve your site. Add it, then drop the folder again. |
| `analysis.block.empty` | This folder is empty. Nothing to deploy. |

### Repo name field

| Key | String |
|---|---|
| `repo.label` | Repository name |
| `repo.helper` | Will publish to: {username}.github.io/{repo} |
| `repo.error.charset` | Use lowercase letters, numbers, and hyphens only. |
| `repo.error.empty` | Name the repository to continue. |
| `repo.exists.notice` | This repository already exists. Deploying replaces its contents. |
| `repo.button.new` | Deploy to GitHub Pages |
| `repo.button.update` | Update site |

### Token gate (Deploy view, no token)

| Key | String |
|---|---|
| `gate.title` | Connect GitHub to deploy |
| `gate.body` | PagePilot needs a personal access token with Contents and Pages permissions. Takes about two minutes. Your project stays loaded. |
| `gate.button` | Open Settings |

### Deploy progress

| Key | String |
|---|---|
| `step.create` / `step.create.done` | Creating repository… / Repository created |
| `step.update` / `step.update.done` | Preparing repository… / Repository ready |
| `step.upload` / `.done` | Uploading files… {n} of {total} / {total} files uploaded |
| `step.pages` / `.done` | Enabling GitHub Pages… / Pages enabled |
| `step.build` / `.done` | Building your site… / Site published |
| `step.build.slow` | GitHub usually takes about a minute. You can leave this view; we'll keep checking. |
| `deploy.canceled` | Deploy canceled. Files already uploaded remain in the repository. |
| `deploy.retry` | Retry from this step |

### Success

| Key | String |
|---|---|
| `success.title` | Your site is live |
| `success.actions` | Open site · Run launch checklist · Deploy another project |
| `success.stats` | Deployed {n} files in {duration} |
| `success.copied` | URL copied |

### Errors (progress log detail + toast)

| Key | String |
|---|---|
| `err.401` | GitHub rejected the token. It may have expired or been revoked. Update it in Settings. |
| `err.403.scope` | The token can't write to this repository. It needs Contents and Pages read/write permission. |
| `err.403.rate` | GitHub's rate limit hit. It resets at {time}. Retry then. |
| `err.422.name` | A repository named "{repo}" already exists and can't be reused. Pick another name. |
| `err.upload.file` | {name} failed to upload. Retry resumes from this file. |
| `err.build.failed` | GitHub Pages build failed: {reason}. Fix the file and deploy again. |
| `err.offline` | You're offline. The deploy will not resume on its own; retry when you're back. |
| `err.generic` | GitHub returned an error ({status}) during "{step}". Copy the log and retry. |

### Checklist — the ten items

Format per row: finding string for each state, then "Why it matters" body.

| Item | Pass | Warn / Fail | Why it matters |
|---|---|---|---|
| index.html | Found at project root. | **Fail:** Missing. Pages has nothing to serve. | Pages serves index.html as your homepage. Without it, visitors see a 404. |
| 404.html | Custom 404 page found. | **Fail:** No custom 404 page. Visitors who hit a bad link see GitHub's default error page. | A branded 404 keeps lost visitors on your site instead of a dead end. |
| .nojekyll | Present. Files serve exactly as uploaded. | **Warn:** Missing. GitHub runs Jekyll and can silently drop folders starting with "_". | Without it, directories like _assets never reach the live site and the build runs slower. |
| Meta description | Found ({n} characters). | **Warn:** Missing or empty. | Search engines and link previews use it as your one-line pitch. Missing means they invent one. |
| Open Graph tags | og:title, og:description, og:image found. | **Warn:** Missing {tags}. | These control how your link looks when shared. Without them, shares render as a bare URL. |
| Favicon | Found ({file}). | **Warn:** None found. Browsers show a blank tab icon. | The tab icon is your smallest, most-seen brand surface. |
| robots.txt | Found. | **Warn:** Missing. Crawlers use defaults (index everything). | Fine for most sites; add one if anything shouldn't be indexed. |
| Canonical link | Points to {url}. | **Warn:** Missing. **Fail:** Points to a different domain: {url}. | Tells search engines which URL is the real one, so duplicates don't split your ranking. |
| HTTPS enforced | Enforced on {url}. | **Fail:** Not enforced. Visitors can load the site over plain HTTP. | Browsers flag HTTP as "not secure" and some features (clipboard, geolocation) refuse to run. |
| Custom domain | {domain} configured, DNS verified. | **Pending:** No custom domain. Using {user}.github.io/{repo}. | Optional. A CNAME file plus DNS gives the site your own domain. |

| Key | String |
|---|---|
| `checklist.empty.title` | No project to check |
| `checklist.empty.body` | Load a project on the Deploy tab and the checklist fills in on its own. |
| `checklist.empty.cta` | Go to Deploy |
| `checklist.postdeploy.pending` | Runs after your first deploy |
| `checklist.summary` | {passed} of {total} pass |

### Health view

| Key | String |
|---|---|
| `health.empty.title` | Nothing deployed yet |
| `health.empty.body` | Once you deploy a site, its build status, HTTPS state, and metadata show up here. |
| `health.empty.cta` | Deploy a site |
| `health.build.building` | Building… started {time} |
| `health.build.built` | Built · {time} |
| `health.build.errored` | Build failed · {reason} |
| `health.meta.blocked` | Couldn't read the live page from this browser. Open the site to check its tags directly. |
| `health.checked` | Checked {time} |

### Settings

| Key | String |
|---|---|
| `token.label` | Personal access token |
| `token.help` | Needs a fine-grained token with Contents and Pages read/write on the repositories you'll deploy. Create one at github.com → Settings → Developer settings. |
| `token.test` | Test connection |
| `token.testing` | Testing… |
| `token.ok` | Connected as @{username} |
| `token.err.invalid` | GitHub didn't accept this token. Check it was copied in full and hasn't expired. |
| `token.err.scope` | Token works but can't create repositories. Grant Contents and Pages read/write. |
| `token.err.network` | Couldn't reach GitHub. Check your connection and retry. |
| `storage.session` | This session only — cleared when you close the app |
| `storage.device` | On this device — stays until you clear it |
| `token.clear` | Clear token |
| `token.cleared` | Token removed from this browser. |
| `security.note` | Your token stays in this browser. PagePilot has no server; the token is sent only to api.github.com. "On this device" stores it in local storage, readable by anyone who uses this browser profile. |

---

## g. Top 5 UX risks and mitigations

**1. Browser capability gaps around folder input.**
Safari and Firefox lack `showDirectoryPicker`; touch devices can't drag folders at all. Risk: the hero interaction fails for a third of users.
Mitigation: feature-detect at render, never at click. The dropzone always offers a path that works in the current browser: FS Access picker → `webkitdirectory` input → multi-file input, with `drop.unsupported` copy explaining the downgrade. On touch, the picker button is the hero and drag affordances don't render. QA matrix covers Safari iOS, Firefox desktop, Chrome Android before ship.

**2. Token fear and token mishandling.**
A PAT that can write repos is a credential worth stealing, and users know it. Risk: abandonment at the gate, or worse, users pasting an over-scoped classic token onto a shared machine.
Mitigation: gate appears only at the moment of need with work preserved; scope guidance names the two fine-grained permissions and nothing more; storage defaults to session-only; the security panel states the exact network destination (`api.github.com`) and the local-storage tradeoff in plain words; Clear token is one click and confirmed by toast.

**3. The Pages build wait reads as a hang.**
Upload finishes in seconds, then GitHub builds for 30–90+ seconds with no visible motion. Risk: users refresh mid-deploy or assume failure.
Mitigation: "Build & publish" is an explicit step with its own spinner; at 20 seconds the `step.build.slow` line sets expectations and licenses leaving; polling survives tab switches, the nav badge shows it's still working, and a notification fires if the app is backgrounded. Refreshing the page re-attaches to the poll via the persisted deploy record.

**4. Silent overwrite of an existing repository.**
Deploying to a name that already exists replaces its contents. Risk: a user wipes a repo they didn't mean to touch.
Mitigation: repo existence check on field blur, before the button is pressed; the button relabels to "Update site" and the `repo.exists.notice` line states "replaces its contents" in the helper position the user is already reading. Recent-deploy repos pre-fill so the common update path never involves typing a name blind.

**5. Wrong-folder drops at real-world scale.**
Users drop the parent folder, the repo with `node_modules`, or a folder where index.html sits in `/dist`. Risk: 20-minute uploads of 40,000 files, or a deployed site that 404s.
Mitigation: analysis runs before any network call and is the gate. Auto-exclude list (`node_modules`, `.git`, `.DS_Store`, common build caches) with a visible "skipped" warning; `analysis.warn.deepindex` catches the /dist case and names the fix; per-file 25 MB and total-count warnings appear in the summary card with counts, so the user sees the blast radius before pressing Deploy.

---

## Build notes for engineering

- Routes are hash-based (`#/deploy` etc.) so the PWA works from `file://`-adjacent and subpath hosting without a service-worker router.
- Deploy state machine: `idle → analyzing → ready → gated → deploying(step) → success | failed(step) | canceled`. Persist `{repo, url, timestamp, buildId}` per deploy to `localStorage` for Recent deploys and Health; persist the in-flight snapshot to `sessionStorage` for the Settings detour and refresh-during-build.
- One `aria-live="polite"` announcer element for the whole app (progress + toasts route through it); error toasts use a separate `role="alert"` node.
- All icons from one inline SVG sprite in index.html. No image assets anywhere.
- Manifest: `display: standalone`, `theme_color` per scheme via two manifest entries is unsupported, so set `theme_color: #14171C` and rely on `<meta name="theme-color" media="(prefers-color-scheme: …)">` pairs.
- Contrast verification script for the token table lives with the design notes; re-run it if any hex changes.
