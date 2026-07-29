// Deployment engine: pushes the selected files as a single commit to the
// target repo, enables GitHub Pages, and polls the build until it's live.
//
// onProgress(step, message, state) is called for each stage so the UI can
// render a live log. state: 'run' | 'done' | 'error'.

import { fileToBase64 } from './files.js';

const BLOB_CONCURRENCY = 6;

export function canonicalUrlFor(owner, repo) {
  const user = owner.toLowerCase();
  if (repo.toLowerCase() === `${user}.github.io`) return `https://${user}.github.io/`;
  return `https://${user}.github.io/${repo}/`;
}

export async function deploy({ gh, owner, repoName, branch, entries, extraFiles = [], message, onProgress }) {
  const log = (step, msg, state = 'run') => onProgress?.(step, msg, state);

  // 1. Ensure the repository exists.
  log('repo', `Checking repository ${owner}/${repoName}…`);
  let repo;
  let created = false;
  try {
    repo = await gh.getRepo(owner, repoName);
  } catch (err) {
    if (err.status !== 404) throw err;
    log('repo', `Creating repository ${owner}/${repoName}…`);
    repo = await gh.createRepo(repoName, 'Deployed with PagePilot — GitHub Pages');
    created = true;
    await waitFor(async () => gh.getRef(owner, repoName, repo.default_branch || branch), 8, 750);
  }
  const defaultBranch = repo.default_branch || branch;
  const targetBranch = branch || defaultBranch;
  log('repo', created ? `Created ${repo.full_name}.` : `Using existing ${repo.full_name}.`, 'done');

  // 2. Upload every file as a blob.
  const all = [...entries];
  for (const f of extraFiles) {
    if (!all.some((e) => e.path === f.path)) {
      all.push({ path: f.path, file: new File([f.content], f.path.split('/').pop()) });
    }
  }
  log('upload', `Uploading ${all.length} files…`);
  const treeItems = [];
  let done = 0;
  await runPool(all, BLOB_CONCURRENCY, async (entry) => {
    const b64 = await fileToBase64(entry.file);
    const blob = await gh.createBlob(owner, repoName, b64);
    treeItems.push({ path: entry.path, mode: '100644', type: 'blob', sha: blob.sha });
    done += 1;
    if (done % 10 === 0 || done === all.length) {
      log('upload', `Uploading files… ${done}/${all.length}`);
    }
  });
  log('upload', `Uploaded ${all.length} files.`, 'done');

  // 3. Commit the snapshot (fresh tree = repo mirrors the upload exactly).
  log('commit', 'Creating commit…');
  const tree = await gh.createTree(owner, repoName, treeItems);
  let parents = [];
  try {
    const ref = await gh.getRef(owner, repoName, targetBranch);
    parents = [ref.object.sha];
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const commit = await gh.createCommit(
    owner,
    repoName,
    message || `Deploy via PagePilot (${new Date().toISOString()})`,
    tree.sha,
    parents
  );
  if (parents.length) {
    await gh.updateRef(owner, repoName, targetBranch, commit.sha);
  } else {
    await gh.createRef(owner, repoName, targetBranch, commit.sha);
  }
  log('commit', `Committed ${commit.sha.slice(0, 7)} to ${targetBranch}.`, 'done');

  // 4. Enable GitHub Pages on the branch.
  log('pages', 'Configuring GitHub Pages…');
  let pages;
  try {
    pages = await gh.createPages(owner, repoName, targetBranch);
  } catch (err) {
    if (err.status === 409) {
      pages = await gh.getPages(owner, repoName); // already enabled
    } else if (err.status === 403 || err.status === 404) {
      throw Object.assign(
        new Error(
          'Could not enable Pages. Check that your token has the "Pages" (fine-grained) or full "repo" (classic) permission, and that Pages is allowed for private repos on your plan.'
        ),
        { cause: err }
      );
    } else {
      throw err;
    }
  }
  log('pages', 'GitHub Pages configured.', 'done');

  // 5. Wait for the build to go live.
  log('build', 'Waiting for the Pages build…');
  const url = pages?.html_url || canonicalUrlFor(owner, repoName);
  let status = 'unknown';
  try {
    const built = await waitFor(
      async () => {
        const b = await gh.latestPagesBuild(owner, repoName);
        if (b && (b.status === 'built' || b.status === 'errored')) return b;
        throw new Error('building');
      },
      20,
      3000
    );
    status = built.status;
  } catch {
    status = 'building';
  }
  if (status === 'errored') {
    log('build', 'Pages build reported an error — check the repo settings on GitHub.', 'error');
  } else if (status === 'built') {
    log('build', 'Build complete — site is live.', 'done');
  } else {
    log('build', 'Build still in progress — the site will be live shortly.', 'done');
  }

  return { url, repo: `${owner}/${repoName}`, branch: targetBranch, commit: commit.sha, buildStatus: status };
}

export async function fetchHealth(gh, owner, repoName) {
  const pages = await gh.getPages(owner, repoName);
  let build = null;
  try {
    build = await gh.latestPagesBuild(owner, repoName);
  } catch {
    /* no builds yet */
  }
  return {
    url: pages.html_url,
    status: pages.status, // built | building | errored | null
    httpsEnforced: !!pages.https_enforced,
    customDomain: pages.cname || null,
    buildStatus: build?.status || null,
    buildUpdatedAt: build?.updated_at || null,
    buildError: build?.error?.message || null,
  };
}

async function runPool(items, limit, worker) {
  const queue = [...items];
  const errors = [];
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (err) {
        errors.push({ item, err });
        queue.length = 0; // abort remaining work on first failure
      }
    }
  });
  await Promise.all(lanes);
  if (errors.length) throw errors[0].err;
}

async function waitFor(fn, attempts, delayMs) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
