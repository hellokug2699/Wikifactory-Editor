import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubError } from '../app/assets/js/github.js';
import { createSubmitJournal } from '../app/assets/js/submit-journal.js';
import { CONTENT_REPO } from '../app/assets/js/state.js';

const OWNER = 'owner';
const REPO = CONTENT_REPO;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

class FakeClient extends GitHubClient {
  constructor({ branchTip = 'base', findQueue = [] } = {}) {
    super('token');
    this.calls = [];
    this.branchTip = branchTip;
    this.findQueue = [...findQueue];
  }

  async getUser() {
    return { login: 'user', scopes: '' };
  }

  async getRepo() {
    return { default_branch: 'main' };
  }

  async getRef(owner, repo, branch) {
    this.calls.push(['getRef', branch]);
    if (!this.branchTip) throw new GitHubError('not found', 404);
    return { object: { sha: this.branchTip } };
  }

  async getCommit(owner, repo, sha) {
    this.calls.push(['getCommit', sha]);
    return { tree: { sha: 'tree-base' } };
  }

  async createRef(owner, repo, branch, sha) {
    this.calls.push(['createRef', branch, sha]);
    this.branchTip = sha;
    return {};
  }

  async createBlob() {
    this.calls.push(['createBlob']);
    return 'blob-new';
  }

  async createTree(owner, repo, baseTree) {
    this.calls.push(['createTree', baseTree]);
    return 'tree-new';
  }

  async createCommit(owner, repo, message, tree, parents) {
    this.calls.push(['createCommit', tree, ...parents]);
    return 'commit-new';
  }

  async updateRef(owner, repo, branch, sha) {
    this.calls.push(['updateRef', branch, sha]);
    this.branchTip = sha;
    return {};
  }

  async findOpenPullRequest() {
    this.calls.push(['findOpenPullRequest']);
    return this.findQueue.length ? this.findQueue.shift() : null;
  }

  async createPullRequest() {
    this.calls.push(['createPullRequest']);
    throw new GitHubError('请求 GitHub API 超时', 0);
  }
}

const options = {
  owner: OWNER,
  repo: REPO,
  branchName: 'content-test',
  files: [{ path: 'games/A/B/page.md', text: 'body' }],
  commitMessage: 'content: test',
  prTitle: 'content: test',
  prBody: 'body',
};

test('resumes after a commit without re-uploading or re-committing', async () => {
  const storage = memoryStorage();
  const journal = createSubmitJournal({ storage });
  journal.write({
    owner: OWNER,
    repo: REPO,
    base: 'main',
    branch: options.branchName,
    headOwner: OWNER,
    forkUsed: false,
    baseSha: 'base',
    commitSha: 'commit-prev',
    prNumber: 0,
    stage: 'pr-pending',
    startedAt: 1,
  });

  const client = new FakeClient({
    branchTip: 'commit-prev',
    findQueue: [{ number: 12, html_url: 'https://example/pr/12' }],
  });
  const result = await client.submitPullRequest({ ...options, journal });

  const kinds = client.calls.map((call) => call[0]);
  assert.ok(!kinds.includes('createBlob'));
  assert.ok(!kinds.includes('createCommit'));
  assert.ok(!kinds.includes('updateRef'));
  assert.equal(result.number, 12);
  assert.equal(journal.read(), null);
});

test('resumes after the branch was created but the commit failed', async () => {
  const storage = memoryStorage();
  const journal = createSubmitJournal({ storage });
  journal.write({
    owner: OWNER,
    repo: REPO,
    base: 'main',
    branch: options.branchName,
    headOwner: OWNER,
    forkUsed: false,
    baseSha: 'base',
    commitSha: '',
    prNumber: 0,
    stage: 'branch',
    startedAt: 1,
  });

  const client = new FakeClient({ branchTip: 'base' });
  client.createPullRequest = async () => {
    client.calls.push(['createPullRequest']);
    return { number: 5, html_url: 'https://example/pr/5' };
  };
  const result = await client.submitPullRequest({ ...options, journal });

  const kinds = client.calls.map((call) => call[0]);
  assert.ok(kinds.includes('createCommit'));
  assert.ok(kinds.includes('updateRef'));
  assert.equal(result.number, 5);
  assert.equal(journal.read(), null);
});

test('a timed-out PR creation is found on the next attempt', async () => {
  const storage = memoryStorage();
  const journal = createSubmitJournal({ storage });
  const client = new FakeClient({ branchTip: 'base' });

  await assert.rejects(client.submitPullRequest({ ...options, journal }), /超时/);
  const entry = journal.read();
  assert.equal(entry.stage, 'pr-pending');
  assert.equal(entry.commitSha, 'commit-new');

  // The PR was actually created; the retry looks it up instead of duplicating.
  client.findQueue.push({ number: 7, html_url: 'https://example/pr/7' });
  const kindsBefore = client.calls.filter((call) => call[0] === 'createCommit').length;
  const result = await client.submitPullRequest({ ...options, journal });
  assert.equal(result.number, 7);
  assert.equal(client.calls.filter((call) => call[0] === 'createCommit').length, kindsBefore);
  assert.equal(journal.read(), null);
});
