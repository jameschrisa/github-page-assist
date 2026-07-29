// Fake GitHub client for deploy.js orchestration tests. Records every call
// and returns configurable canned responses so we never touch the network.

export class FakeGitHubError extends Error {
  constructor(status, message = `error ${status}`) {
    super(message);
    this.status = status;
  }
}

let blobCounter = 0;

export function createFakeGh(overrides = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });

  const defaults = {
    getRepo: async (owner, repo) => ({ full_name: `${owner}/${repo}`, default_branch: 'main' }),
    createRepo: async (name) => ({ full_name: `owner/${name}`, default_branch: 'main' }),
    getRef: async () => ({ object: { sha: 'existing-parent-sha' } }),
    createRef: async () => ({}),
    updateRef: async () => ({}),
    createBlob: async () => ({ sha: `blob-sha-${blobCounter++}` }),
    createTree: async () => ({ sha: 'tree-sha-1' }),
    createCommit: async () => ({ sha: 'commit-sha-1234567' }),
    createPages: async () => ({ html_url: 'https://owner.github.io/repo/', status: 'building' }),
    getPages: async () => ({ html_url: 'https://owner.github.io/repo/', status: 'built' }),
    latestPagesBuild: async () => ({ status: 'built' }),
  };

  const merged = { ...defaults, ...overrides };
  const client = {};
  for (const [method, impl] of Object.entries(merged)) {
    client[method] = async (...args) => {
      record(method, args);
      return impl(...args);
    };
  }
  client.calls = calls;
  client.callsFor = (method) => calls.filter((c) => c.method === method);
  return client;
}
