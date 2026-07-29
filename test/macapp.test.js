// Verifies the packaged macOS app (dist/PagePilot.app) and installer DMG
// built by tools/build-macos-app.sh. These artifacts are only present on a
// dev machine that has run the build script (CI won't have them, and the
// bundle format is macOS-specific), so every test in this file is skipped
// unless we're on darwin AND dist/PagePilot.app exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = path.join(ROOT, 'dist', 'PagePilot.app');
const DMG = path.join(ROOT, 'dist', 'PagePilot-Installer.dmg');

const isDarwin = process.platform === 'darwin';
const appExists = existsSync(APP);
const skip = !isDarwin || !appExists
  ? (isDarwin ? 'dist/PagePilot.app not found (run tools/build-macos-app.sh first)' : 'macOS bundle checks only apply on darwin')
  : false;

describe('dist/PagePilot.app bundle', { skip }, () => {
  const contents = path.join(APP, 'Contents');
  const resources = path.join(contents, 'Resources');
  const appDir = path.join(resources, 'app');

  test('Contents/Info.plist exists and declares the expected keys', () => {
    const plistPath = path.join(contents, 'Info.plist');
    assert.ok(existsSync(plistPath), 'missing Contents/Info.plist');
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], {
      encoding: 'utf8',
    });
    const plist = JSON.parse(json);
    assert.equal(plist.CFBundleExecutable, 'PagePilot');
    assert.equal(plist.CFBundleIconFile, 'icon');
    assert.equal(plist.LSUIElement, true);
  });

  test('Contents/MacOS/PagePilot launcher exists and is executable', () => {
    const launcher = path.join(contents, 'MacOS', 'PagePilot');
    assert.ok(existsSync(launcher), 'missing Contents/MacOS/PagePilot');
    const mode = statSync(launcher).mode;
    // eslint-disable-next-line no-bitwise
    assert.ok(mode & 0o111, 'launcher is missing the executable bit');
  });

  test('Resources/icon.icns exists and is a non-trivial size', () => {
    const icns = path.join(resources, 'icon.icns');
    assert.ok(existsSync(icns), 'missing Resources/icon.icns');
    const { size } = statSync(icns);
    assert.ok(size > 1024, `icon.icns is suspiciously small (${size} bytes)`);
  });

  test('Resources/app contains the full app shell', () => {
    for (const rel of ['index.html', 'js', 'css', 'icons', 'manifest.webmanifest', 'sw.js']) {
      assert.ok(existsSync(path.join(appDir, rel)), `Resources/app is missing ${rel}`);
    }
  });

  test('Resources/app/index.html is byte-identical to the repo index.html', () => {
    const bundled = readFileSync(path.join(appDir, 'index.html'));
    const source = readFileSync(path.join(ROOT, 'index.html'));
    assert.ok(bundled.equals(source), 'bundled index.html has drifted from the repo copy — rerun the build script');
  });
});

describe('dist/PagePilot-Installer.dmg', { skip }, () => {
  test('exists and hdiutil reports a valid UDZO image', () => {
    assert.ok(existsSync(DMG), 'missing dist/PagePilot-Installer.dmg');
    const info = execFileSync('hdiutil', ['imageinfo', DMG], { encoding: 'utf8' });
    assert.match(info, /Format:\s*UDZO/, 'expected a UDZO (compressed, read-only) disk image');
  });
});
