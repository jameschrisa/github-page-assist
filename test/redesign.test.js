// Regression tests for the "de-tab" single-scrolling-view redesign
// (GitHub Primer style, no tabs). These are deliberately text-based —
// they read index.html / js/app.js / css/style.css / sw.js as plain
// strings and never import app.js or ui.js, since those modules assume
// a browser DOM (see test/helpers/dom-stub.js for why other suites need
// a stub instead of just `import`).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('index.html: no leftover tab-bar markup', () => {
  const html = read('index.html');

  test('does not contain a tabs container', () => {
    assert.doesNotMatch(html, /class="tabs"/);
  });

  test('does not contain any data-tab attributes', () => {
    assert.doesNotMatch(html, /data-tab=/);
  });

  test('has a single <main id="view">', () => {
    const mains = [...html.matchAll(/<main\b[^>]*>/g)];
    assert.equal(mains.length, 1, 'expected exactly one <main> element');
    assert.match(mains[0][0], /id="view"/);
  });
});

describe('index.html: required wiring survived the redesign', () => {
  const html = read('index.html');

  test('links to the manifest', () => {
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  });

  test('declares both the dark (#0d1117) and light (#ffffff) theme-color metas', () => {
    assert.match(
      html,
      /<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content="#0d1117">/
    );
    assert.match(
      html,
      /<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="#ffffff">/
    );
  });

  test('has the #announcer polite aria-live region', () => {
    assert.match(html, /<div id="announcer"[^>]*aria-live="polite"[^>]*>/);
  });

  test('has #toasts (role=status) and #toasts-alert (role=alert)', () => {
    assert.match(html, /<div id="toasts" role="status" aria-live="polite">/);
    assert.match(html, /<div id="toasts-alert" role="alert">/);
  });
});

describe('js/app.js: single-view sections replace the old tab routing', () => {
  const appText = read('js/app.js');

  test('renders a #project section', () => {
    assert.match(appText, /box\(\s*['"]project['"]/);
  });

  test('renders a #checklist section', () => {
    assert.match(appText, /box\(\s*['"]checklist['"]/);
  });

  test('renders a #deploy section (manifest shortcut "New deploy" targets #deploy)', () => {
    assert.match(appText, /box\(\s*['"]deploy['"]/);
  });

  test('renders a #health section (manifest shortcut "Site health" targets #health)', () => {
    assert.match(appText, /box\(\s*['"]health['"]/);
  });

  test('renders a #settings section', () => {
    assert.match(appText, /box\(\s*['"]settings['"]/);
  });

  test('registers the service worker', () => {
    assert.match(appText, /navigator\.serviceWorker\.register\(['"]\.\/sw\.js['"]\)/);
  });

  test('has no leftover currentTab state', () => {
    assert.doesNotMatch(appText, /\bcurrentTab\b/);
  });

  test('has no leftover TABS array (old hash-tab router)', () => {
    assert.doesNotMatch(appText, /\bTABS\b/);
  });
});

describe('manifest shortcuts still resolve to sections that exist', () => {
  test('#deploy and #health shortcuts target ids app.js actually renders', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    const shortcutHashes = (manifest.shortcuts || []).map((s) => s.url.split('#')[1]);
    assert.ok(shortcutHashes.includes('deploy'), 'expected a shortcut targeting #deploy');
    assert.ok(shortcutHashes.includes('health'), 'expected a shortcut targeting #health');
  });
});

describe('css/style.css: Primer design tokens survived the redesign', () => {
  const css = read('css/style.css');
  const tokens = [
    '--canvas',
    '--border-default',
    '--fg-default',
    '--accent-fg',
    '--success-emphasis',
    '--danger-fg',
  ];

  // Isolate the base :root block (before the first @media) and the
  // prefers-color-scheme: dark block, so we can assert each token is
  // defined in both rather than just "somewhere in the file."
  function rootBlock() {
    const m = css.match(/^:root\s*{([\s\S]*?)\n}/m);
    assert.ok(m, 'could not locate the base :root block');
    return m[1];
  }

  function darkRootBlock() {
    const m = css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([\s\S]*?)}\s*}/);
    assert.ok(m, 'could not locate the prefers-color-scheme: dark :root block');
    return m[1];
  }

  for (const token of tokens) {
    test(`base :root defines ${token}`, () => {
      assert.match(rootBlock(), new RegExp(`${token}\\s*:`));
    });
    test(`dark :root override defines ${token}`, () => {
      assert.match(darkRootBlock(), new RegExp(`${token}\\s*:`));
    });
  }

  test('retains a prefers-reduced-motion block', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test('retains :focus-visible styling', () => {
    assert.match(css, /:focus-visible/);
  });
});

describe('sw.js: cache VERSION was bumped for the redesign', () => {
  test('VERSION is not the original pagepilot-v1', () => {
    const swText = read('sw.js');
    const m = swText.match(/const VERSION = ['"]([^'"]+)['"]/);
    assert.ok(m, 'could not locate the VERSION constant in sw.js');
    assert.notEqual(m[1], 'pagepilot-v1', 'VERSION must be bumped whenever the shell/markup changes');
  });
});
