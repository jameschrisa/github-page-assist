import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));

  test('parses as valid JSON with the required top-level fields', () => {
    assert.equal(typeof manifest.name, 'string');
    assert.ok(manifest.name.length > 0);
    assert.equal(manifest.start_url, './index.html');
    assert.equal(manifest.display, 'standalone');
  });

  test('declares both a 192px and a 512px icon', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192'), 'missing a 192x192 icon entry');
    assert.ok(sizes.includes('512x512'), 'missing a 512x512 icon entry');
  });

  test('at least one icon declares purpose "maskable"', () => {
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  });

  test('every icon file referenced by the manifest actually exists on disk', () => {
    for (const icon of manifest.icons) {
      const full = path.join(ROOT, icon.src);
      assert.ok(existsSync(full), `manifest references missing icon: ${icon.src}`);
    }
  });

  test('every shortcut icon file referenced by the manifest exists on disk', () => {
    for (const shortcut of manifest.shortcuts || []) {
      for (const icon of shortcut.icons || []) {
        const full = path.join(ROOT, icon.src);
        assert.ok(existsSync(full), `shortcut "${shortcut.name}" references missing icon: ${icon.src}`);
      }
    }
  });
});

describe('sw.js precache shell', () => {
  const swText = read('sw.js');

  function parseShellArray(text) {
    const m = text.match(/const SHELL = \[([\s\S]*?)\];/);
    assert.ok(m, 'could not locate the SHELL array in sw.js');
    const body = m[1];
    const entries = [...body.matchAll(/'([^']+)'|"([^"]+)"/g)].map((mm) => mm[1] ?? mm[2]);
    assert.ok(entries.length > 0, 'SHELL array appears to be empty');
    return entries;
  }

  test('every entry in the SHELL precache list exists on disk (relative to project root)', () => {
    const entries = parseShellArray(swText);
    for (const entry of entries) {
      if (entry === './') continue; // resolves to index.html via the server, not a distinct file
      const rel = entry.replace(/^\.\//, '');
      const full = path.join(ROOT, rel);
      assert.ok(existsSync(full), `sw.js SHELL references missing file: ${entry}`);
    }
  });

  test('SHELL includes the manifest and the app entry point', () => {
    const entries = parseShellArray(swText);
    assert.ok(entries.includes('./manifest.webmanifest'));
    assert.ok(entries.includes('./js/app.js'));
  });
});

describe('index.html PWA wiring', () => {
  const html = read('index.html');

  test('links to the manifest', () => {
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  });

  test('declares both a dark and a light theme-color meta tag', () => {
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: dark\)"/);
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: light\)"/);
  });

  test('loads js/app.js as a module', () => {
    assert.match(html, /<script type="module" src="js\/app\.js"><\/script>/);
  });
});

describe('service worker registration', () => {
  test('js/app.js registers sw.js', () => {
    const appText = read('js/app.js');
    assert.match(appText, /serviceWorker/);
    assert.match(appText, /navigator\.serviceWorker\.register\(['"]\.\/sw\.js['"]\)/);
  });
});
