import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

// The only real-time delay in deploy.js is `await new Promise(r => setTimeout(r, delayMs))`
// inside its internal waitFor() retry helper. We don't need real wall-clock waits to prove
// the orchestration logic is correct, so we make every setTimeout fire on the next tick.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

const { deploy, canonicalUrlFor, fetchHealth } = await import('../js/deploy.js');
const { createFakeGh, FakeGitHubError } = await import('./helpers/fake-gh.js');

function makeEntries(n) {
  return Array.from({ length: n }, (_, i) => ({
    path: `file-${i}.txt`,
    file: new File([`content ${i}`], `file-${i}.txt`),
  }));
}

function collectProgress() {
  const events = [];
  const onProgress = (step, message, state) => events.push({ step, message, state });
  return { events, onProgress };
}

describe('canonicalUrlFor', () => {
  test('a repo named <user>.github.io deploys to the root URL', () => {
    assert.equal(canonicalUrlFor('alice', 'alice.github.io'), 'https://alice.github.io/');
  });

  test('any other repo deploys to a /reponame/ subpath', () => {
    assert.equal(canonicalUrlFor('alice', 'my-project'), 'https://alice.github.io/my-project/');
  });

  test('owner is lowercased regardless of input case', () => {
    assert.equal(canonicalUrlFor('Alice', 'my-project'), 'https://alice.github.io/my-project/');
  });

  test('the <user>.github.io match is case-insensitive on both sides', () => {
    assert.equal(canonicalUrlFor('Alice', 'ALICE.GITHUB.IO'), 'https://alice.github.io/');
  });
});

describe('deploy(): repository creation vs reuse', () => {
  test('creates the repo when it does not yet exist (404)', async () => {
    const gh = createFakeGh({
      getRepo: async () => {
        throw new FakeGitHubError(404);
      },
    });
    const { onProgress, events } = collectProgress();
    await deploy({ gh, owner: 'owner', repoName: 'new-repo', branch: 'main', entries: makeEntries(2), onProgress });

    assert.equal(gh.callsFor('createRepo').length, 1);
    assert.equal(gh.callsFor('createRepo')[0].args[0], 'new-repo');
    const repoEvents = events.filter((e) => e.step === 'repo');
    assert.ok(repoEvents.some((e) => /Creating repository/.test(e.message)));
    assert.ok(repoEvents.some((e) => e.state === 'done' && /Created/.test(e.message)));
  });

  test('reuses the existing repo without calling createRepo', async () => {
    const gh = createFakeGh();
    const { onProgress, events } = collectProgress();
    await deploy({ gh, owner: 'owner', repoName: 'existing-repo', branch: 'main', entries: makeEntries(2), onProgress });

    assert.equal(gh.callsFor('createRepo').length, 0);
    const repoEvents = events.filter((e) => e.step === 'repo');
    assert.ok(repoEvents.some((e) => e.state === 'done' && /Using existing/.test(e.message)));
  });

  test('a non-404 error from getRepo aborts the deploy without creating a repo', async () => {
    const gh = createFakeGh({
      getRepo: async () => {
        throw new FakeGitHubError(500, 'server exploded');
      },
    });
    await assert.rejects(
      deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) }),
      /server exploded/
    );
    assert.equal(gh.callsFor('createRepo').length, 0);
  });
});

describe('deploy(): blob upload', () => {
  test('uploads a blob for every entry', async () => {
    const gh = createFakeGh();
    const entries = makeEntries(9);
    await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries });
    assert.equal(gh.callsFor('createBlob').length, 9);
  });

  test('dedupes extraFiles against paths already present in entries', async () => {
    const gh = createFakeGh();
    const entries = makeEntries(2); // file-0.txt, file-1.txt
    const extraFiles = [
      { path: 'file-0.txt', content: 'should be ignored, duplicate of entries' },
      { path: '.nojekyll', content: '' },
    ];
    let capturedTree;
    const originalCreateTree = gh.createTree;
    gh.createTree = async (owner, repo, tree) => {
      capturedTree = tree;
      return originalCreateTree(owner, repo, tree);
    };

    await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries, extraFiles });

    // 2 original entries + 1 genuinely new extra file = 3 blobs, not 4.
    assert.equal(gh.callsFor('createBlob').length, 3);
    const paths = capturedTree.map((t) => t.path).sort();
    assert.deepEqual(paths, ['.nojekyll', 'file-0.txt', 'file-1.txt']);
  });

  test('every tree item carries the blob sha returned by createBlob', async () => {
    const gh = createFakeGh();
    const entries = makeEntries(3);
    let capturedTree;
    const originalCreateTree = gh.createTree;
    gh.createTree = async (owner, repo, tree) => {
      capturedTree = tree;
      return originalCreateTree(owner, repo, tree);
    };
    await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries });
    assert.equal(capturedTree.length, 3);
    for (const item of capturedTree) {
      assert.equal(item.mode, '100644');
      assert.equal(item.type, 'blob');
      assert.ok(item.sha, 'expected each tree item to have a sha');
    }
  });

  test('a failing blob upload rejects the whole deploy', async () => {
    const boom = new Error('network blip uploading blob');
    const gh = createFakeGh({
      createBlob: async () => {
        throw boom;
      },
    });
    await assert.rejects(
      deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(10) }),
      (err) => err === boom
    );
  });
});

describe('deploy(): commit/ref creation', () => {
  test('creates a new ref when the target branch does not exist yet', async () => {
    const gh = createFakeGh({
      getRef: async () => {
        throw new FakeGitHubError(404);
      },
    });
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'gh-pages', entries: makeEntries(1) });

    assert.equal(gh.callsFor('createRef').length, 1);
    assert.equal(gh.callsFor('updateRef').length, 0);
    const [owner, repo, branch, sha] = gh.callsFor('createRef')[0].args;
    assert.equal(owner, 'owner');
    assert.equal(repo, 'repo');
    assert.equal(branch, 'gh-pages');
    assert.equal(sha, result.commit);
  });

  test('updates the existing ref, using its sha as the commit parent, when the branch exists', async () => {
    const gh = createFakeGh({
      getRef: async () => ({ object: { sha: 'parent-sha-abc' } }),
    });
    await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) });

    assert.equal(gh.callsFor('createRef').length, 0);
    assert.equal(gh.callsFor('updateRef').length, 1);
    const [, , , , parents] = gh.callsFor('createCommit')[0].args;
    assert.deepEqual(parents, ['parent-sha-abc']);
  });

  test('a non-404 error from getRef propagates instead of being treated as "branch missing"', async () => {
    const gh = createFakeGh({
      getRef: async () => {
        throw new FakeGitHubError(500);
      },
    });
    await assert.rejects(deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) }));
  });
});

describe('deploy(): Pages configuration', () => {
  test('falls back to getPages when createPages returns 409 (already enabled)', async () => {
    const gh = createFakeGh({
      createPages: async () => {
        throw new FakeGitHubError(409);
      },
      getPages: async () => ({ html_url: 'https://owner.github.io/repo/', status: 'built' }),
    });
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) });
    assert.equal(gh.callsFor('getPages').length, 1);
    assert.equal(result.url, 'https://owner.github.io/repo/');
  });

  test('surfaces a helpful permissions error when createPages returns 403', async () => {
    const gh = createFakeGh({
      createPages: async () => {
        throw new FakeGitHubError(403);
      },
    });
    await assert.rejects(
      deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) }),
      /Pages/
    );
  });

  test('an unrelated createPages error propagates unchanged', async () => {
    const gh = createFakeGh({
      createPages: async () => {
        throw new FakeGitHubError(500, 'boom');
      },
    });
    await assert.rejects(
      deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) }),
      /boom/
    );
  });
});

describe('deploy(): build status polling', () => {
  test('maps a "built" status to a done, "site is live" message', async () => {
    const gh = createFakeGh({ latestPagesBuild: async () => ({ status: 'built' }) });
    const { onProgress, events } = collectProgress();
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1), onProgress });
    assert.equal(result.buildStatus, 'built');
    const buildDone = events.find((e) => e.step === 'build' && e.state === 'done');
    assert.match(buildDone.message, /Build complete/);
  });

  test('maps an "errored" status to an error-state message', async () => {
    const gh = createFakeGh({ latestPagesBuild: async () => ({ status: 'errored' }) });
    const { onProgress, events } = collectProgress();
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1), onProgress });
    assert.equal(result.buildStatus, 'errored');
    const buildErr = events.find((e) => e.step === 'build' && e.state === 'error');
    assert.ok(buildErr, 'expected an error-state build event');
  });

  test('a build that never reports built/errored still resolves deploy() with a "building" status', async () => {
    const gh = createFakeGh({ latestPagesBuild: async () => ({ status: 'in_progress' }) });
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) });
    assert.equal(result.buildStatus, 'building');
  });

  test('latestPagesBuild that always throws also resolves with "building" rather than rejecting', async () => {
    const gh = createFakeGh({
      latestPagesBuild: async () => {
        throw new FakeGitHubError(404);
      },
    });
    const result = await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(1) });
    assert.equal(result.buildStatus, 'building');
  });
});

describe('deploy(): onProgress sequencing', () => {
  test('emits steps in the expected order for a full successful deploy', async () => {
    const gh = createFakeGh();
    const { onProgress, events } = collectProgress();
    await deploy({ gh, owner: 'owner', repoName: 'repo', branch: 'main', entries: makeEntries(3), onProgress });

    const stepOrder = [];
    for (const e of events) {
      if (stepOrder[stepOrder.length - 1] !== e.step) stepOrder.push(e.step);
    }
    assert.deepEqual(stepOrder, ['repo', 'upload', 'commit', 'pages', 'build']);

    // Every step except the ones that intentionally stay non-terminal should end 'done'.
    const lastPerStep = {};
    for (const e of events) lastPerStep[e.step] = e;
    assert.equal(lastPerStep.repo.state, 'done');
    assert.equal(lastPerStep.upload.state, 'done');
    assert.equal(lastPerStep.commit.state, 'done');
    assert.equal(lastPerStep.pages.state, 'done');
    assert.equal(lastPerStep.build.state, 'done');
  });
});

describe('fetchHealth', () => {
  test('shapes the pages + build status into a flat health object', async () => {
    const gh = createFakeGh({
      getPages: async () => ({ html_url: 'https://owner.github.io/repo/', status: 'built', https_enforced: true, cname: 'example.com' }),
      latestPagesBuild: async () => ({ status: 'built', updated_at: '2026-01-01T00:00:00Z' }),
    });
    const health = await fetchHealth(gh, 'owner', 'repo');
    assert.deepEqual(health, {
      url: 'https://owner.github.io/repo/',
      status: 'built',
      httpsEnforced: true,
      customDomain: 'example.com',
      buildStatus: 'built',
      buildUpdatedAt: '2026-01-01T00:00:00Z',
      buildError: null,
    });
  });

  test('tolerates latestPagesBuild throwing (repo with no builds yet)', async () => {
    const gh = createFakeGh({
      getPages: async () => ({ html_url: 'https://owner.github.io/repo/', status: null }),
      latestPagesBuild: async () => {
        throw new FakeGitHubError(404);
      },
    });
    const health = await fetchHealth(gh, 'owner', 'repo');
    assert.equal(health.buildStatus, null);
    assert.equal(health.buildUpdatedAt, null);
  });
});

after(() => {
  globalThis.setTimeout = realSetTimeout;
});
