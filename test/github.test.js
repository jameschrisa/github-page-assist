import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let calls;
let nextResponse;

function stubFetch() {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return nextResponse(url, opts);
  };
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  calls = [];
  stubFetch();
});

after(() => {
  globalThis.fetch = realFetch;
});

const { makeClient, GitHubError, TOKEN_HELP_URL } = await import('../js/github.js');

describe('makeClient request plumbing', () => {
  test('GET requests carry auth headers and no body/content-type', async () => {
    nextResponse = () => jsonResponse(200, { login: 'octocat' });
    const client = makeClient('secret-token');
    const user = await client.getUser();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/user');
    assert.equal(calls[0].opts.method, 'GET');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer secret-token');
    assert.equal(calls[0].opts.headers.Accept, 'application/vnd.github+json');
    assert.equal(calls[0].opts.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(calls[0].opts.headers['Content-Type'], undefined);
    assert.equal(calls[0].opts.body, undefined);
    assert.deepEqual(user, { login: 'octocat' });
  });

  test('POST requests with a body are JSON-encoded and set Content-Type', async () => {
    nextResponse = () => jsonResponse(201, { sha: 'abc123' });
    const client = makeClient('t');
    await client.createBlob('owner', 'repo', 'aGVsbG8=');

    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { content: 'aGVsbG8=', encoding: 'base64' });
    assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/git/blobs');
  });

  test('a 204 No Content response resolves to null', async () => {
    nextResponse = () => ({ status: 204, ok: true, json: async () => null, text: async () => '' });
    const client = makeClient('t');
    const result = await client.getRef('owner', 'repo', 'main');
    assert.equal(result, null);
  });

  test('a non-ok response with a JSON message throws a GitHubError carrying status + body', async () => {
    nextResponse = () => jsonResponse(404, { message: 'Not Found' });
    const client = makeClient('t');
    await assert.rejects(client.getRepo('owner', 'missing-repo'), (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 404);
      assert.equal(err.message, 'Not Found');
      assert.deepEqual(err.body, { message: 'Not Found' });
      return true;
    });
  });

  test('a non-ok response with an unparsable body falls back to a generic message', async () => {
    nextResponse = () => ({
      status: 500,
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
      text: async () => 'internal server error',
    });
    const client = makeClient('t');
    await assert.rejects(client.getRepo('owner', 'repo'), (err) => {
      assert.equal(err.status, 500);
      assert.equal(err.message, 'GitHub API error 500');
      return true;
    });
  });

  test('createPages posts the branch as the Pages source', async () => {
    nextResponse = () => jsonResponse(201, { html_url: 'https://owner.github.io/repo/' });
    const client = makeClient('t');
    await client.createPages('owner', 'repo', 'main');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { source: { branch: 'main', path: '/' } });
  });
});

describe('exports', () => {
  test('TOKEN_HELP_URL points at the GitHub tokens settings page', () => {
    assert.equal(TOKEN_HELP_URL, 'https://github.com/settings/tokens');
  });
});
