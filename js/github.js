// Minimal GitHub REST API client. Token-authenticated, browser fetch only.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(token, path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = raw ? await res.text() : await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.message) || `GitHub API error ${res.status}`;
    throw new GitHubError(msg, res.status, data);
  }
  return data;
}

export function makeClient(token) {
  const call = (path, opts) => request(token, path, opts);
  return {
    // --- auth / user ---
    getUser: () => call('/user'),

    // --- repos ---
    getRepo: (owner, repo) => call(`/repos/${owner}/${repo}`),
    createRepo: (name, description) =>
      call('/user/repos', {
        method: 'POST',
        body: { name, description, auto_init: true, has_wiki: false, has_projects: false },
      }),

    // --- git data (used to push a whole snapshot in one commit) ---
    getRef: (owner, repo, branch) => call(`/repos/${owner}/${repo}/git/ref/heads/${branch}`),
    createRef: (owner, repo, branch, sha) =>
      call(`/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha },
      }),
    updateRef: (owner, repo, branch, sha) =>
      call(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: { sha, force: true },
      }),
    createBlob: (owner, repo, base64Content) =>
      call(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: { content: base64Content, encoding: 'base64' },
      }),
    createTree: (owner, repo, tree) =>
      call(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: { tree } }),
    createCommit: (owner, repo, message, treeSha, parents) =>
      call(`/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        body: { message, tree: treeSha, parents },
      }),

    // --- pages ---
    getPages: (owner, repo) => call(`/repos/${owner}/${repo}/pages`),
    createPages: (owner, repo, branch) =>
      call(`/repos/${owner}/${repo}/pages`, {
        method: 'POST',
        body: { source: { branch, path: '/' } },
      }),
    updatePages: (owner, repo, patch) =>
      call(`/repos/${owner}/${repo}/pages`, { method: 'PUT', body: patch }),
    latestPagesBuild: (owner, repo) => call(`/repos/${owner}/${repo}/pages/builds/latest`),
  };
}

// PATs created for Pages deploys need: repo (classic) or, for fine-grained
// tokens: Contents read/write, Pages read/write, Administration read/write
// (repo creation), Metadata read.
export const TOKEN_HELP_URL = 'https://github.com/settings/tokens';
