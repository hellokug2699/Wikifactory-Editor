import assert from 'node:assert/strict';
import { GitHubClient } from '../app/assets/js/github.js';
import { repoInfo } from './repo.mjs';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

const { contentRepo: REPO_NAME } = repoInfo();

/** A tiny in-memory GitHub API. */
function createMock({ writable, existingBranch = '' }) {
  const state = {
    refs: new Map([[`o/${REPO_NAME}@main`, 'base-sha']]),
    commits: new Map([['base-sha', { tree: { sha: 'base-tree' } }]]),
    pulls: [],
    blobs: [],
    trees: [],
    commitsCreated: [],
    branchUpdates: [],
  };

  function response(status, data, headers = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      text: async () => (data === null ? '' : JSON.stringify(data)),
    };
  }

  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const body = options.body ? JSON.parse(options.body) : null;

    if (path === '/user') return response(200, { login: 'contributor' }, { 'x-oauth-scopes': 'public_repo' });
    if (path === `/repos/o/${REPO_NAME}`) return response(200, { default_branch: 'main', full_name: `o/${REPO_NAME}` });
    if (path === `/repos/contributor/${REPO_NAME}`) {
      if (!state.refs.has(`contributor/${REPO_NAME}@main`)) state.refs.set(`contributor/${REPO_NAME}@main`, 'base-sha');
      return response(200, { default_branch: 'main', full_name: `contributor/${REPO_NAME}` });
    }
    if (path === `/repos/o/${REPO_NAME}/forks` && method === 'POST')
      return response(202, { full_name: `contributor/${REPO_NAME}` });

    const refMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/.exec(path);
    if (refMatch && method === 'GET') {
      const key = `${refMatch[1]}/${refMatch[2]}@${refMatch[3]}`;
      const sha = state.refs.get(key);
      return sha ? response(200, { object: { sha } }) : response(404, { message: 'Not Found' });
    }

    const commitMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([^/]+)$/.exec(path);
    if (commitMatch && method === 'GET') {
      const data = state.commits.get(commitMatch[3]);
      return data ? response(200, { sha: commitMatch[3], ...data }) : response(404, { message: 'Not Found' });
    }

    const createRefMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/.exec(path);
    if (createRefMatch && method === 'POST') {
      const owner = createRefMatch[1];
      const repo = createRefMatch[2];
      if (existingBranch && body.ref === `refs/heads/${existingBranch}`) {
        return response(422, { message: 'Reference already exists' });
      }
      if (owner === 'o' && !writable) {
        return response(403, { message: 'Resource not accessible by personal access token' });
      }
      const key = `${owner}/${repo}@${body.ref.replace('refs/heads/', '')}`;
      state.refs.set(key, body.sha);
      return response(201, { ref: body.ref, object: { sha: body.sha } });
    }

    const patchRefMatch = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/.exec(path);
    if (patchRefMatch && method === 'PATCH') {
      const key = `${patchRefMatch[1]}/${patchRefMatch[2]}@${patchRefMatch[3]}`;
      state.refs.set(key, body.sha);
      state.branchUpdates.push({ key, sha: body.sha });
      return response(200, { object: { sha: body.sha } });
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/.test(path) && method === 'POST') {
      const sha = `blob-${state.blobs.length + 1}`;
      state.blobs.push(body);
      return response(201, { sha });
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/.test(path) && method === 'POST') {
      const sha = `tree-${state.trees.length + 1}`;
      state.trees.push(body);
      return response(201, { sha });
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/.test(path) && method === 'POST') {
      const sha = `commit-${state.commitsCreated.length + 1}`;
      state.commitsCreated.push(body);
      state.commits.set(sha, { tree: { sha: body.tree } });
      return response(201, { sha });
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/merge-upstream$/.test(path) && method === 'POST') {
      return response(204, null);
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/pulls/.test(path) && method === 'POST') {
      const number = state.pulls.length + 1;
      const pr = { number, html_url: `https://github.com/o/${REPO_NAME}/pull/${number}`, ...body };
      state.pulls.push(pr);
      return response(201, pr);
    }

    if (/^\/repos\/([^/]+)\/([^/]+)\/pulls/.test(path) && method === 'GET') {
      return response(200, state.pulls);
    }

    return response(404, { message: `Unhandled ${method} ${path}` });
  };

  return state;
}

console.log('GitHub client self-test');

await test('direct branch PR (write access)', async () => {
  const state = createMock({ writable: true });
  const client = new GitHubClient('token');
  const result = await client.submitPullRequest({
    owner: 'o',
    repo: REPO_NAME,
    branchName: 'wfe/test',
    files: [
      { path: 'games/Game/Category/Page.md', text: '# hello' },
      { path: 'games/Game/assets/images/pic.png', base64: 'AAAA' },
    ],
    commitMessage: 'content: test',
    prTitle: 'content: test',
    prBody: 'body',
  });
  assert.equal(result.forkUsed, false);
  assert.equal(state.pulls[0].head, 'wfe/test');
  assert.equal(state.pulls[0].base, 'main');
  assert.equal(state.blobs.length, 2);
  assert.equal(state.trees[0].base_tree, 'base-tree');
  assert.equal(state.commitsCreated[0].parents[0], 'base-sha');
  assert.equal(state.branchUpdates[0].sha, 'commit-1');
});

await test('fork PR fallback (no write access)', async () => {
  const state = createMock({ writable: false });
  const client = new GitHubClient('token');
  const result = await client.submitPullRequest({
    owner: 'o',
    repo: REPO_NAME,
    branchName: 'wfe/fork',
    files: [{ path: 'foo.yml', text: 'foo: Game' }],
    commitMessage: 'alias: test',
    prTitle: 'alias: test',
    prBody: 'body',
  });
  assert.equal(result.forkUsed, true);
  assert.equal(result.headOwner, 'contributor');
  assert.equal(state.pulls[0].head, 'contributor:wfe/fork');
  assert.ok(state.refs.has(`contributor/${REPO_NAME}@wfe/fork`));
});

await test('branch conflict is reported without auto-renaming', async () => {
  const state = createMock({ writable: true, existingBranch: 'wfe/taken' });
  const client = new GitHubClient('token');
  await assert.rejects(
    client.submitPullRequest({
      owner: 'o',
      repo: REPO_NAME,
      branchName: 'wfe/taken',
      files: [{ path: 'x.md', text: 'x' }],
      commitMessage: 'm',
      prTitle: 't',
      prBody: 'b',
    }),
    (error) => error.code === 'BRANCH_EXISTS' && error.status === 422,
  );
  assert.equal(state.pulls.length, 0);
});

await test('rejects Core / Alias repositories', async () => {
  const client = new GitHubClient('token');
  await assert.rejects(client.getRepo('o', 'Wikifactory-Core'), new RegExp(`仅允许操作 ${REPO_NAME}`));
  await assert.rejects(client.getRepo('o', 'Wikifactory-Alias'), new RegExp(`仅允许操作 ${REPO_NAME}`));
});

console.log(`\n${passed} tests passed.`);
