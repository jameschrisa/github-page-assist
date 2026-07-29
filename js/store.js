// Settings storage. The GitHub token is kept in localStorage ("remember on
// this device") or sessionStorage ("this session only") — never sent anywhere
// except api.github.com.

const TOKEN_KEY = 'pagepilot.token';
const SETTINGS_KEY = 'pagepilot.settings';

const defaults = {
  rememberToken: false, // session-only by default (design spec §7)
  defaultBranch: 'main',
  lastRepo: '',
  lastCanonicalUrl: '',
  lastDeployAt: null,
  lastOwner: '',
};

export function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

const DEPLOYS_KEY = 'pagepilot.deploys';

// Recent deploys, newest first, keyed by repo full name.
export function loadDeploys() {
  try {
    return JSON.parse(localStorage.getItem(DEPLOYS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function recordDeploy({ repo, url, branch }) {
  const rest = loadDeploys().filter((d) => d.repo !== repo);
  const list = [{ repo, url, branch, at: new Date().toISOString() }, ...rest].slice(0, 10);
  localStorage.setItem(DEPLOYS_KEY, JSON.stringify(list));
  return list;
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token, remember) {
  clearToken();
  if (!token) return;
  (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}
