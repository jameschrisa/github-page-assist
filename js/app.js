import { h, toast, badge, box, statusIcon, copyButton, announce } from './ui.js';
import {
  loadSettings,
  saveSettings,
  getToken,
  setToken,
  clearToken,
  loadDeploys,
  recordDeploy,
} from './store.js';
import { makeClient, TOKEN_HELP_URL } from './github.js';
import {
  fromDataTransfer,
  fromFileList,
  fromDirectoryPicker,
  supportsDirectoryPicker,
  formatBytes,
} from './files.js';
import { analyzeProject } from './analyze.js';
import { deploy, fetchHealth, canonicalUrlFor } from './deploy.js';

const state = {
  settings: loadSettings(),
  user: null, // { login, avatar_url } once the token is verified
  project: null, // { entries, analysis }
  repoName: '',
  repoExists: null, // null = unknown, true/false after the debounced check
  tokenGate: false, // deploy was pressed without a token
  fixes: {}, // checklist item id -> enabled
  deploying: false,
  stepStatus: {}, // fixed-step id -> { msg, state }
  deployLog: [], // raw timestamped log for the "Log" disclosure
  deployStartedAt: null,
  deployError: null,
  buildSlow: false,
  deployResult: null,
  health: null,
  liveMeta: null,
  checklistOpen: new Set(), // expanded checklist row ids
  postDeployChecks: {}, // repo full name -> health data (or {loading:true})
};

const viewEl = document.getElementById('view');

// The four fixed progress steps from the design spec (§c.3). deploy.js also
// emits a 'commit' event between uploading blobs and finalizing the tree;
// it is folded into the "Upload files" row since that matches how a user
// reads the step (their files are being written to the repo).
const STEP_ORDER = ['repo', 'upload', 'pages', 'build'];
const STEP_LABELS = {
  repo: () => (state.repoExists === true ? 'Update repository' : 'Create repository'),
  upload: () => 'Upload files',
  pages: () => 'Enable GitHub Pages',
  build: () => 'Build & publish',
};

// --- boot ---

init();

async function init() {
  // Single scrolling page now — the app is built once, then a hash in the
  // URL (e.g. from a manifest shortcut, ./index.html#health) just needs an
  // initial scroll to the matching section. Subsequent in-page <a href="#…">
  // clicks are handled natively by the browser plus `scroll-behavior: smooth`.
  render();
  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (getToken()) verifyToken(getToken(), { silent: true });
}

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Cross-section navigation helper: replaces the old tab jumps. Scrolls the
// target Box into view (respecting reduced motion) and optionally focuses
// a control inside it once the scroll has started.
function goTo(sectionId, focusSelector) {
  const target = document.getElementById(sectionId);
  target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (focusSelector) {
    document.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
}

// --- rendering ---

function render() {
  viewEl.replaceChildren(
    projectSection(),
    checklistSection(),
    deploySection(),
    healthSection(),
    settingsSection()
  );
  renderAccountChip();
}

function renderAccountChip() {
  const chip = document.getElementById('account-chip');
  chip.hidden = false;
  chip.replaceChildren(
    state.user
      ? h('span', { class: 'chip connected' },
          h('img', { src: state.user.avatar_url, alt: '', width: 20, height: 20 }),
          h('span', {}, `@${state.user.login}`)
        )
      : h('a', { class: 'chip not-connected', href: '#settings' },
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          'Not connected'
        )
  );
}

// --- #project ---

function projectSection() {
  const body = [dropzone()];
  if (state.project) body.push(projectSummary());
  return box('project', 'Project', ...body);
}

function dropzone() {
  const compact = !!state.project;
  const idleText = compact ? 'Drop a new folder to replace this project' : 'Drop your project folder here';
  const activeText = 'Drop to analyze';
  const label = h('strong', {}, idleText);

  const fileInput = h('input', {
    type: 'file',
    webkitdirectory: true,
    multiple: true,
    hidden: true,
    onchange: (e) => e.target.files.length && ingest(fromFileList(e.target.files)),
  });
  const filesOnlyInput = h('input', {
    type: 'file',
    multiple: true,
    hidden: true,
    onchange: (e) => e.target.files.length && ingest(fromFileList(e.target.files)),
  });

  const zone = h('div',
    {
      class: `dropzone${compact ? ' compact' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-label': compact
        ? 'Add a new project folder: drop here or press Enter to browse'
        : 'Add your project: drop a folder here or press Enter to browse',
      onclick: () => fileInput.click(),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click()),
    },
    h('div', { class: 'dz-icon', 'aria-hidden': 'true' }, '📁'),
    h('p', {}, label),
    h('div', { class: 'actions' },
      supportsDirectoryPicker()
        ? h('button', {
            type: 'button',
            class: 'primary',
            onclick: async (e) => {
              e.stopPropagation();
              try {
                ingest(await fromDirectoryPicker());
              } catch (err) {
                if (err.name !== 'AbortError') toast(err.message, { error: true });
              }
            },
          }, 'Choose folder')
        : h('button', { type: 'button', class: 'primary', onclick: (e) => { e.stopPropagation(); fileInput.click(); } }, 'Choose folder'),
      h('button', { type: 'button', class: 'ghost', onclick: (e) => { e.stopPropagation(); filesOnlyInput.click(); } }, 'Pick files instead')
    ),
    fileInput,
    filesOnlyInput
  );

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
    label.textContent = activeText;
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
    label.textContent = idleText;
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    label.textContent = idleText;
    try {
      ingest(await fromDataTransfer(e.dataTransfer));
    } catch (err) {
      toast(`Could not read the dropped folder: ${err.message}`, { error: true });
    }
  });
  return zone;
}

async function ingest(entriesPromise) {
  const entries = await entriesPromise;
  if (!entries.length) {
    toast('No usable files found in that selection', { error: true });
    return;
  }
  const guessedName = state.repoName || guessRepoName(entries);
  state.repoName = guessedName;
  state.deployResult = null;
  state.stepStatus = {};
  state.deployLog = [];
  state.deployError = null;
  const analysis = await analyzeProject(entries, {
    repoName: guessedName,
    canonicalUrl: state.user ? canonicalUrlFor(state.user.login, guessedName) : '',
  });
  state.project = { entries, analysis };
  // Default the safe auto-fixes on.
  state.fixes = {};
  for (const item of analysis.items) {
    if (item.fix && item.state === 'warn' && (item.id === 'nojekyll' || item.id === 'notfound')) {
      state.fixes[item.id] = true;
    }
  }
  toast(`Loaded ${entries.length} files (${formatBytes(analysis.totalBytes)})`);
  render();
}

function guessRepoName(entries) {
  const first = entries[0]?.file;
  const rel = first?.webkitRelativePath || '';
  const root = rel.split('/')[0];
  const base = root && root !== first?.name ? root : 'my-site';
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-site';
}

function projectSummary() {
  const { analysis } = state.project;
  const { fails, warns } = analysis.score;
  return h('div', { class: 'box-section' },
    h('div', { class: 'row' },
      h('span', { 'aria-hidden': 'true' }, '📁'),
      h('h3', { style: 'margin: 0;' }, state.repoName || 'Project'),
      h('span', { class: 'spacer' }),
      badge(fails ? 'fail' : warns ? 'warn' : 'pass', fails ? `${fails} blocker${fails > 1 ? 's' : ''}` : warns ? `${warns} suggestion${warns > 1 ? 's' : ''}` : 'Ready'),
      h('button', { class: 'ghost', type: 'button', 'aria-label': `Clear ${state.repoName || 'project'}`, onclick: resetProject }, '✕')
    ),
    h('p', { class: 'muted' },
      `${analysis.fileCount} files · ${formatBytes(analysis.totalBytes)}`,
      analysis.head?.title ? ` · "${analysis.head.title}"` : ''
    ),
    fails
      ? h('p', {}, 'Fix the blockers in the ', h('a', { href: '#checklist' }, 'checklist'), ' before deploying.')
      : h('p', {}, 'Review the ', h('a', { href: '#checklist' }, 'checklist'), ' for pre-flight suggestions — quick fixes can be added automatically.'),
    h('details', {},
      h('summary', { class: 'small muted' }, 'Show files'),
      h('div', { class: 'file-list' }, analysis.entries.slice(0, 500).map((e) => h('div', {}, e.path)))
    )
  );
}

function resetProject() {
  state.project = null;
  state.repoName = '';
  state.repoExists = null;
  state.fixes = {};
  state.stepStatus = {};
  state.deployLog = [];
  state.deployResult = null;
  state.deployError = null;
  state.buildSlow = false;
  state.checklistOpen = new Set();
  render();
}

// --- #deploy ---

function deploySection() {
  const body = [];
  if (!state.project) {
    body.push(h('p', { class: 'quiet' }, 'Load a project above to configure your destination and deploy.'));
    const recent = recentDeploysBlock();
    if (recent) body.push(recent);
    return box('deploy', 'Deploy', ...body);
  }

  body.push(destinationBlock());
  const showProgress = state.deploying || (Object.keys(state.stepStatus).length > 0 && !state.deployResult);
  if (showProgress) body.push(progressBlock());
  if (state.deployResult) body.push(successBlock());
  return box('deploy', 'Deploy', ...body);
}

function recentDeploysBlock() {
  const deploys = loadDeploys();
  if (!deploys.length) return null;
  return h('div', { class: 'box-section' },
    h('h3', {}, 'Recent deploys'),
    deploys.map((d) =>
      h('div', { class: 'row', style: 'padding: 6px 0;' },
        h('div', {},
          h('div', {}, h('strong', {}, d.repo)),
          h('a', { class: 'small', href: d.url, target: '_blank', rel: 'noopener' }, d.url)
        ),
        h('span', { class: 'spacer' }),
        h('span', { class: 'small muted', title: d.at }, relativeTime(d.at)),
        copyButton(d.url)
      )
    )
  );
}

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
}

function destinationBlock() {
  const { analysis } = state.project;
  const blocked = analysis.score.fails > 0;

  const nameInput = h('input', {
    type: 'text',
    id: 'repo-name',
    value: state.repoName,
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: (e) => {
      state.repoName = e.target.value.trim();
      state.repoExists = null;
    },
    onblur: () => checkRepoExists(),
  });

  const fixCount = Object.values(state.fixes).filter(Boolean).length;
  const isUpdate = state.repoExists === true;

  return h('div', {},
    h('h3', {}, 'Destination'),
    h('div', { class: 'field' },
      h('label', { for: 'repo-name' }, 'Repository name'),
      nameInput,
      h('p', { class: 'hint' },
        state.user
          ? `Will publish to: ${canonicalUrlFor(state.user.login, state.repoName || 'my-site')}`
          : 'Connect GitHub to preview the site URL.'
      ),
      isUpdate && h('p', { class: 'hint', style: 'color: var(--attention-fg);' },
        'This repository already exists. Deploying replaces its contents.')
    ),
    fixCount > 0 && h('p', { class: 'small muted' }, `${fixCount} auto-fix${fixCount > 1 ? 'es' : ''} from the checklist will be included.`),
    state.tokenGate && !getToken()
      ? h('div', { class: 'notice info' },
          h('p', {}, h('strong', {}, 'Connect GitHub to deploy')),
          h('p', { class: 'small' }, 'PagePilot needs a personal access token with Contents and Pages permissions. Takes about two minutes. Your project stays loaded.'),
          h('button', { class: 'primary', type: 'button', onclick: () => goTo('settings', '#gh-token') }, 'Open Settings')
        )
      : h('div', { class: 'row' },
          h('button', {
            class: 'primary lg',
            type: 'button',
            disabled: blocked || state.deploying || !state.repoName,
            onclick: startDeploy,
          }, state.deploying ? 'Deploying…' : isUpdate ? 'Update site' : 'Deploy to GitHub Pages'),
          blocked && h('span', { class: 'small muted' }, 'Fix the blockers in the checklist first')
        )
  );
}

let repoCheckTimer = null;
function checkRepoExists() {
  const token = getToken();
  if (!token || !state.user || !state.repoName) return;
  clearTimeout(repoCheckTimer);
  const name = state.repoName;
  repoCheckTimer = setTimeout(async () => {
    try {
      await makeClient(token).getRepo(state.user.login, name);
      if (state.repoName === name) {
        state.repoExists = true;
        render();
      }
    } catch {
      if (state.repoName === name) {
        state.repoExists = false;
        render();
      }
    }
  }, 300);
}

// Throttles screen-reader announcements to one per step change, or one per
// 25% of upload progress (design spec §c.3 "Screen reader behavior").
let lastAnnounce = { step: null, bucket: -1 };
let buildSlowTimer = null;

function maybeAnnounce(step, msg, st) {
  if (st === 'error') {
    announce(msg);
    lastAnnounce = { step, bucket: -1 };
    return;
  }
  const m = /(\d+)\s*\/\s*(\d+)/.exec(msg);
  const bucket = m ? Math.floor((Number(m[1]) / Number(m[2])) * 4) : -1;
  if (step === lastAnnounce.step && m && bucket === lastAnnounce.bucket) return;
  lastAnnounce = { step, bucket };
  announce(msg);
}

async function startDeploy() {
  const token = getToken();
  if (!state.project) return;
  if (!token) {
    // Token gate: swap the button for the connect panel (design spec flow 1).
    state.tokenGate = true;
    render();
    return;
  }
  if (!/^[a-z0-9._-]+$/i.test(state.repoName)) {
    toast('Repository names can only use letters, numbers, dots, dashes and underscores', { error: true });
    return;
  }

  state.deploying = true;
  state.stepStatus = {};
  state.deployLog = [];
  state.deployError = null;
  state.buildSlow = false;
  state.deployResult = null;
  state.deployStartedAt = Date.now();
  lastAnnounce = { step: null, bucket: -1 };
  clearTimeout(buildSlowTimer);
  buildSlowTimer = null;
  render();

  const gh = makeClient(token);
  try {
    if (!state.user) state.user = await gh.getUser();
    const canonicalUrl = canonicalUrlFor(state.user.login, state.repoName);

    // Materialize enabled checklist fixes.
    const extraFiles = [];
    for (const item of state.project.analysis.items) {
      if (item.fix && state.fixes[item.id]) {
        extraFiles.push({ path: item.fix.path, content: item.fix.generate() });
      }
    }

    const result = await deploy({
      gh,
      owner: state.user.login,
      repoName: state.repoName,
      branch: state.settings.defaultBranch || 'main',
      entries: state.project.entries,
      extraFiles,
      onProgress: (step, msg, st) => {
        state.deployLog.push({ at: new Date(), step, msg, st });
        const dispStep = step === 'commit' ? 'upload' : step;
        state.stepStatus[dispStep] = { msg, state: st };
        maybeAnnounce(step, msg, st);

        if (dispStep === 'build') {
          if (st === 'run' && !buildSlowTimer) {
            buildSlowTimer = setTimeout(() => {
              state.buildSlow = true;
              render();
            }, 20000);
          } else if (st !== 'run') {
            clearTimeout(buildSlowTimer);
            buildSlowTimer = null;
          }
        }
        render();
      },
    });

    state.deployResult = {
      ...result,
      canonicalUrl: result.url || canonicalUrl,
      fileCount: state.project.entries.length,
      durationSec: Math.max(1, Math.round((Date.now() - state.deployStartedAt) / 1000)),
    };
    recordDeploy({ repo: result.repo, url: state.deployResult.canonicalUrl, branch: result.branch });
    state.settings = saveSettings({
      lastRepo: `${state.user.login}/${state.repoName}`,
      lastCanonicalUrl: state.deployResult.canonicalUrl,
      lastDeployAt: new Date().toISOString(),
      lastOwner: state.user.login,
    });
    delete state.postDeployChecks[result.repo]; // re-check post-deploy items against the fresh deploy
    toast('Deploy complete 🎉');
  } catch (err) {
    const message = friendlyError(err);
    state.deployLog.push({ at: new Date(), step: 'error', msg: message, st: 'error' });
    state.deployError = message;
    announce(message);
    toast(message, { error: true, ms: 6000 });
  } finally {
    state.deploying = false;
    clearTimeout(buildSlowTimer);
    buildSlowTimer = null;
    render();
  }
}

function friendlyError(err) {
  if (err.status === 401) return 'GitHub rejected the token (401). Re-check it in Settings.';
  if (err.status === 403 && /rate limit/i.test(err.message)) return 'GitHub rate limit hit — wait a few minutes and retry.';
  if (err.status === 422 && /name already exists/i.test(err.message)) return 'A repo with that name already exists with different history. Pick another name or redeploy to it.';
  return err.message || 'Something went wrong.';
}

function uploadPercent(msg) {
  const m = msg && /(\d+)\s*\/\s*(\d+)/.exec(msg);
  if (!m) return null;
  return Math.min(100, Math.round((Number(m[1]) / Number(m[2])) * 100));
}

function stepListItem(id) {
  const st = state.stepStatus[id];
  const cls = st ? st.state : 'pending';
  const label = STEP_LABELS[id]();
  const msg = st ? st.msg : label;
  const icon = { pending: '○', run: '◐', done: '✓', error: '✕', canceled: '–' }[cls] || '○';
  const pct = id === 'upload' ? (cls === 'done' ? 100 : uploadPercent(st?.msg)) : null;
  return h('li', { class: cls },
    h('div', { class: 'step-row' },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', { class: 'step-msg' }, `${icon} ${msg}`)
    ),
    pct != null && h('div', { class: 'progress-bar' }, h('span', { style: `width:${pct}%` })),
    id === 'build' && state.buildSlow && cls === 'run' &&
      h('p', { class: 'step-note' }, 'GitHub usually takes about a minute. You can leave this view; we’ll keep checking.')
  );
}

function logDisclosure() {
  if (!state.deployLog.length) return '';
  const text = state.deployLog.map((l) => `${l.at.toLocaleTimeString()} [${l.step}] ${l.msg}`).join('\n');
  return h('details', { class: 'log-disclosure' },
    h('summary', {}, 'Log'),
    h('div', { class: 'log-header' }, copyButton(text, 'Copy log')),
    // aria-live="off": this is a verbose raw log, not the announcer (spec build notes).
    h('div', { class: 'log-list', 'aria-live': 'off' },
      state.deployLog.map((l) => h('div', {}, `${l.at.toLocaleTimeString()} ${l.msg}`))
    )
  );
}

function progressBlock() {
  return h('div', { class: 'box-section' },
    h('h3', {}, state.deploying ? `Deploying ${state.repoName}` : 'Deployment progress'),
    h('ul', { class: 'steps' }, STEP_ORDER.map(stepListItem)),
    state.deployError && h('div', { class: 'notice danger' },
      h('p', {}, state.deployError),
      !state.deploying && h('button', { type: 'button', onclick: startDeploy }, 'Retry')
    ),
    logDisclosure()
  );
}

function successBlock() {
  const r = state.deployResult;
  return h('div', { class: 'box-section' },
    h('div', { class: 'success-icon', 'aria-hidden': 'true' }, '✓'),
    h('h3', { class: 'success-title' }, 'Your site is live'),
    h('div', { class: 'copy-field' },
      h('a', { href: r.canonicalUrl, target: '_blank', rel: 'noopener' }, r.canonicalUrl),
      copyButton(r.canonicalUrl)
    ),
    h('div', { class: 'action-stack' },
      h('a', { class: 'btn primary lg block', href: r.canonicalUrl, target: '_blank', rel: 'noopener' }, 'Open site ↗'),
      h('a', { class: 'btn block', href: '#checklist' }, 'Run launch checklist'),
      h('button', { type: 'button', class: 'block', onclick: checkSiteHealthAndScroll }, 'Check site health'),
      h('button', { type: 'button', class: 'ghost block', onclick: resetProject }, 'Deploy another project')
    ),
    h('p', { class: 'small muted' },
      `Deployed ${r.fileCount ?? 0} files in ${r.durationSec ?? '?'}s`,
      r.buildStatus === 'building' ? ' · build finishing up, give it a minute' : ''
    ),
    h('p', {},
      h('a', { class: 'small', href: `https://github.com/${r.repo}`, target: '_blank', rel: 'noopener' }, 'View repo on GitHub')
    )
  );
}

// Post-deploy "Check site health" — replaces the old tab jump with a
// same-page action: runs the Health section's own check for the repo that
// was just deployed, then scrolls #health into view once it has data.
function checkSiteHealthAndScroll() {
  const repo = state.deployResult?.repo;
  if (!repo) return;
  checkHealth(repo).then(() => goTo('health'));
}

// --- #checklist ---

function checklistSection() {
  if (!state.project) {
    return box('checklist', 'Readiness checklist',
      h('p', { class: 'quiet' }, 'Load a project and the checklist fills in on its own.')
    );
  }

  // May kick off a background fetch of post-deploy status; must run before
  // postDeployItems() so a freshly-started "loading" state renders immediately.
  maybeFetchPostDeployChecks();

  const before = state.project.analysis.items;
  const after = postDeployItems();
  const passed = before.filter((i) => i.state === 'pass').length + after.filter((i) => i.state === 'pass').length;
  const total = before.length + after.length;

  return box('checklist', 'Readiness checklist',
    h('p', { class: 'small muted' }, `${state.repoName || 'Project'} · ${passed} of ${total} pass`),
    h('div', { class: 'check-group-label' }, 'Before deploy'),
    before.map(checklistRow),
    h('div', { class: 'check-group-label' }, 'After deploy'),
    after.map(checklistRow),
    h('div', { class: 'row', style: 'margin-top: var(--space-3);' },
      h('button', { type: 'button', onclick: reRunChecks }, 'Re-run checks')
    )
  );
}

async function reRunChecks() {
  if (!state.project) return;
  const analysis = await analyzeProject(state.project.entries, {
    repoName: state.repoName,
    canonicalUrl: state.user ? canonicalUrlFor(state.user.login, state.repoName) : '',
  });
  state.project = { ...state.project, analysis };
  toast('Checklist re-run');
  render();
}

function checklistRow(item) {
  const bodyId = `check-body-${item.id}`;
  const btnId = `check-toggle-${item.id}`;
  const open = state.checklistOpen.has(item.id);
  return h('div', { class: 'check-item' },
    h('button', {
      type: 'button',
      id: btnId,
      class: 'check-row-toggle',
      'aria-expanded': String(open),
      'aria-controls': bodyId,
      onclick: () => {
        if (open) state.checklistOpen.delete(item.id);
        else state.checklistOpen.add(item.id);
        render();
      },
    },
      statusIcon(item.state),
      h('span', { class: 'check-row-label' }, item.label),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, '⌄')
    ),
    h('div', { id: bodyId, class: 'check-row-body', role: 'region', 'aria-labelledby': btnId, hidden: !open },
      h('p', {}, item.detail),
      item.why && h('p', { class: 'why' }, h('strong', {}, 'Why it matters: '), item.why),
      item.fix && item.state !== 'pass' && fixRow(item)
    )
  );
}

function fixRow(item) {
  return h('div', { class: 'fix-row' },
    h('label', { class: 'check-row' },
      h('input', {
        type: 'checkbox',
        checked: !!state.fixes[item.id],
        onchange: (e) => { state.fixes[item.id] = e.target.checked; },
      }),
      h('span', {}, `Generate ${item.fix.path} for me on deploy`)
    )
  );
}

// Post-deploy checklist rows — HTTPS enforced and custom domain only make
// sense once a deploy exists (spec §c.5); they read from the last recorded
// deploy plus a live GitHub Pages status fetch.
function currentRepoFullName() {
  if (state.deployResult?.repo) return state.deployResult.repo;
  if (state.settings.lastOwner && state.repoName) return `${state.settings.lastOwner}/${state.repoName}`;
  return state.settings.lastRepo || null;
}

function postDeployItems() {
  const hasDeploy = !!(state.deployResult || state.settings.lastRepo);
  const whyHttps = 'Browsers flag HTTP as "not secure" and some features (clipboard, geolocation) refuse to run.';
  const whyDomain = 'Optional. A CNAME file plus DNS gives the site your own domain.';

  if (!hasDeploy) {
    return [
      { id: 'https', label: 'HTTPS enforced', state: 'neutral', detail: 'Runs after your first deploy.', why: whyHttps },
      { id: 'custom-domain', label: 'Custom domain', state: 'neutral', detail: 'Runs after your first deploy.', why: whyDomain },
    ];
  }

  const repoFullName = currentRepoFullName();
  const cached = repoFullName ? state.postDeployChecks[repoFullName] : null;

  if (!cached || cached.loading) {
    const detail = cached?.loading ? 'Checking the live site…' : 'Not checked yet.';
    return [
      { id: 'https', label: 'HTTPS enforced', state: 'neutral', detail, why: whyHttps },
      { id: 'custom-domain', label: 'Custom domain', state: 'neutral', detail, why: whyDomain },
    ];
  }

  if (cached.error) {
    return [
      { id: 'https', label: 'HTTPS enforced', state: 'neutral', detail: 'Could not check — connect GitHub in Settings and try again.', why: whyHttps },
      { id: 'custom-domain', label: 'Custom domain', state: 'neutral', detail: 'Could not check — connect GitHub in Settings and try again.', why: whyDomain },
    ];
  }

  return [
    {
      id: 'https',
      label: 'HTTPS enforced',
      state: cached.httpsEnforced ? 'pass' : 'fail',
      detail: cached.httpsEnforced ? `Enforced on ${cached.url}.` : 'Not enforced. Visitors can load the site over plain HTTP.',
      why: whyHttps,
    },
    {
      id: 'custom-domain',
      label: 'Custom domain',
      state: cached.customDomain ? 'pass' : 'neutral',
      detail: cached.customDomain
        ? `${cached.customDomain} configured.`
        : `No custom domain. Using ${cached.url || 'the default github.io URL'}.`,
      why: whyDomain,
    },
  ];
}

function maybeFetchPostDeployChecks() {
  if (!(state.deployResult || state.settings.lastRepo)) return;
  const repoFullName = currentRepoFullName();
  if (!repoFullName) return;
  if (state.postDeployChecks[repoFullName]) return; // already fetched or in flight
  const token = getToken();
  if (!token) return;
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return;

  state.postDeployChecks[repoFullName] = { loading: true };
  fetchHealth(makeClient(token), owner, repo)
    .then((health) => {
      state.postDeployChecks[repoFullName] = { ...health, loading: false };
      render();
    })
    .catch(() => {
      state.postDeployChecks[repoFullName] = { loading: false, error: true };
      render();
    });
}

// --- #health ---

function healthSection() {
  const last = state.settings.lastRepo;
  if (!last && !state.health) {
    return box('health', 'Site health',
      h('p', { class: 'quiet' }, 'Nothing deployed yet. Once you deploy a site, its build status, HTTPS state, and metadata show up here.'),
      h('p', {}, h('a', { class: 'small', href: '#deploy' }, 'Jump to Deploy'))
    );
  }

  const repoInput = h('input', {
    type: 'text',
    id: 'health-repo',
    placeholder: 'owner/repo',
    value: last || '',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const body = [
    h('div', { class: 'field' },
      h('label', { for: 'health-repo' }, 'Repository'),
      h('div', { class: 'input-row' },
        repoInput,
        h('button', {
          class: 'primary',
          type: 'button',
          disabled: !getToken(),
          onclick: () => checkHealth(repoInput.value.trim()),
        }, 'Check')
      ),
      !getToken() && h('p', { class: 'hint' }, 'Add a token in Settings to run health checks.')
    ),
  ];
  if (state.health) body.push(healthResultBlock());
  return box('health', 'Site health', ...body);
}

async function checkHealth(repoSpec) {
  const spec = repoSpec || state.settings.lastRepo;
  const [owner, repo] = (spec || '').split('/');
  if (!owner || !repo) {
    toast('Enter the repository as owner/repo', { error: true });
    return;
  }
  const gh = makeClient(getToken());
  try {
    state.health = { loading: true, repo: spec };
    render();
    const health = await fetchHealth(gh, owner, repo);
    let liveMeta = null;
    try {
      const res = await fetch(health.url, { cache: 'no-store' });
      if (res.ok) {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        liveMeta = {
          httpStatus: res.status,
          title: doc.querySelector('title')?.textContent.trim() || '',
          description: doc.querySelector('meta[name="description" i]')?.content || '',
          ogTitle: doc.querySelector('meta[property="og:title" i]')?.content || '',
          canonical: doc.querySelector('link[rel="canonical" i]')?.href || '',
        };
      } else {
        liveMeta = { httpStatus: res.status };
      }
    } catch {
      liveMeta = null; // site not reachable yet
    }
    state.health = { ...health, repo: spec, liveMeta, checkedAt: new Date() };
  } catch (err) {
    state.health = null;
    toast(err.status === 404 ? 'GitHub Pages is not enabled on that repo yet.' : friendlyError(err), { error: true });
  }
  render();
}

function healthResultBlock() {
  const hc = state.health;
  if (hc.loading) {
    return h('div', { class: 'box-section' }, h('p', { class: 'muted' }, `Checking ${hc.repo}…`));
  }
  const m = hc.liveMeta;
  const statusBadge = { built: 'pass', building: 'warn', errored: 'fail' }[hc.status] || 'neutral';
  return h('div', { class: 'box-section' },
    h('div', { class: 'row' },
      h('h3', {}, hc.repo),
      h('span', { class: 'spacer' }),
      badge(statusBadge, hc.status || 'unknown')
    ),
    h('div', { class: 'url-panel' },
      h('a', { href: hc.url, target: '_blank', rel: 'noopener' }, hc.url),
      copyButton(hc.url, 'Copy canonical URL')
    ),
    h('dl', { class: 'kv' },
      h('dt', {}, 'HTTPS enforced'), h('dd', {}, hc.httpsEnforced ? '✅ Yes' : '⚠️ No — enable it in the repo Pages settings'),
      h('dt', {}, 'Custom domain'), h('dd', {}, hc.customDomain || '— (using github.io)'),
      h('dt', {}, 'Last build'), h('dd', {}, hc.buildStatus ? `${hc.buildStatus}${hc.buildUpdatedAt ? ` · ${new Date(hc.buildUpdatedAt).toLocaleString()}` : ''}` : 'No builds yet'),
      hc.buildError && h('dt', {}, 'Build error'),
      hc.buildError && h('dd', {}, hc.buildError),
      h('dt', {}, 'Site reachable'), h('dd', {}, m ? (m.httpStatus === 200 ? '✅ 200 OK' : `⚠️ HTTP ${m.httpStatus}`) : '⚠️ Not reachable yet (DNS/build may still be propagating)'),
      m?.title != null && h('dt', {}, 'Live <title>'),
      m?.title != null && h('dd', {}, m.title || '⚠️ missing'),
      m?.description != null && h('dt', {}, 'Meta description'),
      m?.description != null && h('dd', {}, m.description || '⚠️ missing'),
      m?.ogTitle != null && h('dt', {}, 'Open Graph'),
      m?.ogTitle != null && h('dd', {}, m.ogTitle ? `og:title "${m.ogTitle}"` : '⚠️ missing'),
      m?.canonical != null && h('dt', {}, 'Canonical tag'),
      m?.canonical != null && h('dd', {}, m.canonical || `⚠️ missing — recommend <link rel="canonical" href="${hc.url}">`)
    ),
    h('p', { class: 'small muted' }, `Checked ${hc.checkedAt.toLocaleTimeString()}`)
  );
}

// --- #settings ---

function settingsSection() {
  const tokenInput = h('input', {
    type: 'password',
    id: 'gh-token',
    placeholder: 'ghp_… or github_pat_…',
    autocomplete: 'off',
    value: getToken(),
  });
  const showBtn = h('button', {
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': 'Show token',
    onclick: () => {
      const showing = tokenInput.type === 'password';
      tokenInput.type = showing ? 'text' : 'password';
      showBtn.textContent = showing ? 'Hide' : 'Show';
      showBtn.setAttribute('aria-pressed', String(showing));
      showBtn.setAttribute('aria-label', showing ? 'Hide token' : 'Show token');
    },
  }, 'Show');

  const rememberBox = h('input', {
    type: 'checkbox',
    checked: state.settings.rememberToken,
    onchange: (e) => {
      state.settings = saveSettings({ rememberToken: e.target.checked });
      const t = getToken();
      if (t) setToken(t, e.target.checked);
    },
  });

  return box('settings', 'GitHub connection',
    h('p', { class: 'small muted' },
      'Create a token at ',
      h('a', { href: TOKEN_HELP_URL, target: '_blank', rel: 'noopener' }, 'github.com/settings/tokens'),
      '. Classic token: “repo” scope. Fine-grained: Contents + Pages + Administration (read/write) and Metadata (read).'
    ),
    h('div', { class: 'field' },
      h('label', { for: 'gh-token' }, 'Personal access token'),
      h('div', { class: 'input-row' }, tokenInput, showBtn)
    ),
    h('label', { class: 'check-row' },
      rememberBox,
      h('span', {}, 'Remember on this device ', h('span', { class: 'muted' }, '(unchecked = cleared when the app closes)'))
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'primary',
        type: 'button',
        onclick: async () => {
          const value = tokenInput.value.trim();
          if (!value) {
            toast('Paste a token first', { error: true });
            return;
          }
          setToken(value, state.settings.rememberToken);
          await verifyToken(value);
        },
      }, 'Save & test connection'),
      h('button', {
        class: 'danger ghost',
        type: 'button',
        onclick: () => {
          clearToken();
          state.user = null;
          tokenInput.value = '';
          toast('Token removed from this device');
          render();
        },
      }, 'Forget token')
    ),
    state.user &&
      h('p', { class: 'small' }, '✅ Connected as ',
        h('strong', {}, `@${state.user.login}`),
        state.user.name ? ` (${state.user.name})` : ''
      ),
    h('p', { class: 'notice info small' },
      'Security note: the token is stored only in this browser and sent only to api.github.com. Prefer a fine-grained token scoped to the repos you deploy, with an expiry. Avoid saving tokens on shared computers — use “this session only”.'
    ),
    h('div', { class: 'box-section' },
      h('h3', {}, 'Install this app'),
      h('p', { class: 'small muted' },
        'PagePilot is installable: in Chrome/Edge use the install icon in the address bar; on iOS Safari use Share → “Add to Home Screen”; on Android use menu → “Install app”. Once installed it works offline and feels native on every device.'
      ),
      state.settings.lastCanonicalUrl &&
        h('p', { class: 'small' }, 'Last deploy: ',
          h('a', { href: state.settings.lastCanonicalUrl, target: '_blank', rel: 'noopener' }, state.settings.lastCanonicalUrl)
        )
    )
  );
}

async function verifyToken(token, { silent = false } = {}) {
  try {
    const gh = makeClient(token);
    state.user = await gh.getUser();
    state.tokenGate = false;
    if (!silent) toast(`Connected as @${state.user.login}`);
  } catch (err) {
    state.user = null;
    if (!silent) toast(err.status === 401 ? 'GitHub rejected that token — double-check it.' : friendlyError(err), { error: true });
  }
  render();
}
