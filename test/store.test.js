import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStorageStubs, resetStorageStubs } from './helpers/storage-stub.js';

installStorageStubs();

const { loadSettings, saveSettings, loadDeploys, recordDeploy, getToken, setToken, clearToken } = await import(
  '../js/store.js'
);

beforeEach(() => resetStorageStubs());

describe('token storage', () => {
  test('setToken(token, true) stores in localStorage, not sessionStorage', () => {
    setToken('ghp_abc123', true);
    assert.equal(localStorage.getItem('pagepilot.token'), 'ghp_abc123');
    assert.equal(sessionStorage.getItem('pagepilot.token'), null);
    assert.equal(getToken(), 'ghp_abc123');
  });

  test('setToken(token, false) stores in sessionStorage, not localStorage', () => {
    setToken('ghp_xyz789', false);
    assert.equal(sessionStorage.getItem('pagepilot.token'), 'ghp_xyz789');
    assert.equal(localStorage.getItem('pagepilot.token'), null);
    assert.equal(getToken(), 'ghp_xyz789');
  });

  test('setToken clears any previous token before writing the new one (no stale copy in the other store)', () => {
    setToken('first-token', true); // lands in localStorage
    setToken('second-token', false); // now lands in sessionStorage
    assert.equal(localStorage.getItem('pagepilot.token'), null);
    assert.equal(sessionStorage.getItem('pagepilot.token'), 'second-token');
  });

  test('setToken with an empty token clears storage without writing anything', () => {
    setToken('something', true);
    setToken('', true);
    assert.equal(getToken(), '');
  });

  test('getToken prefers sessionStorage over localStorage when both are set', () => {
    localStorage.setItem('pagepilot.token', 'from-local');
    sessionStorage.setItem('pagepilot.token', 'from-session');
    assert.equal(getToken(), 'from-session');
  });

  test('getToken returns empty string when no token is stored anywhere', () => {
    assert.equal(getToken(), '');
  });

  test('clearToken removes the token from both storages', () => {
    localStorage.setItem('pagepilot.token', 'a');
    sessionStorage.setItem('pagepilot.token', 'b');
    clearToken();
    assert.equal(localStorage.getItem('pagepilot.token'), null);
    assert.equal(sessionStorage.getItem('pagepilot.token'), null);
    assert.equal(getToken(), '');
  });
});

describe('recordDeploy', () => {
  test('records a deploy as the first (newest) entry', () => {
    const list = recordDeploy({ repo: 'owner/repo', url: 'https://owner.github.io/repo/', branch: 'main' });
    assert.equal(list.length, 1);
    assert.equal(list[0].repo, 'owner/repo');
    assert.ok(list[0].at);
  });

  test('re-deploying the same repo replaces (dedupes) rather than duplicating, and moves it to the front', () => {
    recordDeploy({ repo: 'owner/repo-a', url: 'u-a', branch: 'main' });
    recordDeploy({ repo: 'owner/repo-b', url: 'u-b', branch: 'main' });
    const list = recordDeploy({ repo: 'owner/repo-a', url: 'u-a-2', branch: 'main' });

    assert.equal(list.length, 2);
    assert.equal(list[0].repo, 'owner/repo-a');
    assert.equal(list[0].url, 'u-a-2');
    assert.equal(list.filter((d) => d.repo === 'owner/repo-a').length, 1);
  });

  test('caps the list at 10 entries, dropping the oldest', () => {
    for (let i = 0; i < 12; i += 1) {
      recordDeploy({ repo: `owner/repo-${i}`, url: `u-${i}`, branch: 'main' });
    }
    const list = loadDeploys();
    assert.equal(list.length, 10);
    // Newest first: repo-11 most recent, repo-2 is the oldest survivor (0 and 1 evicted).
    assert.equal(list[0].repo, 'owner/repo-11');
    assert.equal(list[list.length - 1].repo, 'owner/repo-2');
  });

  test('loadDeploys returns an empty array when nothing has been recorded', () => {
    assert.deepEqual(loadDeploys(), []);
  });

  test('loadDeploys tolerates corrupt JSON in storage', () => {
    localStorage.setItem('pagepilot.deploys', 'not valid json{{{');
    assert.deepEqual(loadDeploys(), []);
  });
});

describe('settings', () => {
  test('loadSettings returns defaults when nothing has been saved', () => {
    const settings = loadSettings();
    assert.equal(settings.rememberToken, false);
    assert.equal(settings.defaultBranch, 'main');
    assert.equal(settings.lastRepo, '');
  });

  test('saveSettings merges a partial patch over existing settings and persists it', () => {
    saveSettings({ lastRepo: 'owner/repo' });
    const next = saveSettings({ defaultBranch: 'gh-pages' });
    assert.equal(next.lastRepo, 'owner/repo');
    assert.equal(next.defaultBranch, 'gh-pages');

    const reloaded = loadSettings();
    assert.equal(reloaded.lastRepo, 'owner/repo');
    assert.equal(reloaded.defaultBranch, 'gh-pages');
  });

  test('loadSettings tolerates corrupt JSON in storage and falls back to defaults', () => {
    localStorage.setItem('pagepilot.settings', '{not json');
    const settings = loadSettings();
    assert.equal(settings.defaultBranch, 'main');
  });
});
