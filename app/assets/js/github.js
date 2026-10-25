/** Client-side GitHub REST API (no backend, token stays on this device). */

import { base64ToUtf8, CONTENT_REPO, utf8ToBase64 } from './state.js';
import { notifyGithubUnreachable } from './net-status.js';
import { resumableEntry, submitJournal } from './submit-journal.js';

const API = 'https://api.github.com';

/**
 * The editor may only read from or write to the configured Content repository.
 * `CONTENT_REPO` comes from editor-config.json, so a repo migration does not
 * require a new build, while every other repository stays refused.
 */
function assertContentRepo(repo) {
  if (repo !== CONTENT_REPO) {
    throw new GitHubError(`该编辑器仅允许操作 ${CONTENT_REPO} 仓库，已拒绝访问其他仓库。`);
  }
}

export class GitHubError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.data = data;
    this.code = data?.code || '';
  }
}

function encodePath(path) {
  return String(path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function encodeRef(ref) {
  return String(ref || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function repoBase(owner, repo) {
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export class GitHubClient {
  constructor(token) {
    this.token = token || '';
  }

  async request(path, options = {}) {
    const { method = 'GET', body, accept = 'application/vnd.github+json', timeout = 20000 } = options;
    const headers = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      // Let the header light re-check whether GitHub is actually reachable
      // instead of turning red from a single failed call.
      notifyGithubUnreachable(error);
      const aborted = error?.name === 'AbortError';
      throw new GitHubError(
        aborted
          ? `请求 GitHub API 超时（${Math.round(timeout / 1000)} 秒）。网络较弱时请稍后重试，或先保存本地草稿。`
          : `无法连接 GitHub API：${error instanceof Error ? error.message : String(error)}。请检查网络或代理设置。`,
        0,
      );
    }

    const text = await response.text();
    clearTimeout(timer);
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (!response.ok) {
      if (response.status >= 500) notifyGithubUnreachable({ status: response.status });
      let message = data?.message || `GitHub API 返回 ${response.status}`;
      if (response.status === 401) message = 'token 无效或已过期（401），请在设置中重新填写。';
      else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        message = 'GitHub API 速率限制已用完，请填写 token 或等待重置。';
      } else if (response.status === 404) {
        message = `${message}（404：仓库 / 文件不存在，或 token 没有该仓库的访问权限）`;
      } else if (response.status === 422 && Array.isArray(data?.errors)) {
        message = `${message}：${data.errors
          .map((item) => item.message || item.code)
          .filter(Boolean)
          .join('；')}`;
      }
      throw new GitHubError(message, response.status, data);
    }

    return { data, headers: response.headers };
  }

  async getUser() {
    const { data, headers } = await this.request('/user');
    return {
      login: data.login,
      name: data.name,
      avatar: data.avatar_url,
      scopes: headers.get('x-oauth-scopes') || '',
    };
  }

  /** Latest published release of the editor repository (public, no token needed). */
  async getLatestRelease(owner, repo) {
    const { data } = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`,
    );
    return {
      tag: data.tag_name || '',
      name: data.name || data.tag_name || '',
      url: data.html_url || '',
      publishedAt: data.published_at || '',
      body: data.body || '',
      prerelease: Boolean(data.prerelease),
      assets: Array.isArray(data.assets)
        ? data.assets.map((asset) => ({
            name: asset.name || '',
            size: asset.size || 0,
            url: asset.browser_download_url || '',
          }))
        : [],
    };
  }

  async getRepo(owner, repo) {
    assertContentRepo(repo);
    const { data } = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return data;
  }

  async getRef(owner, repo, branch) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/ref/heads/${encodeRef(branch)}`);
    return data;
  }

  async getCommit(owner, repo, sha) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/commits/${sha}`);
    return data;
  }

  async listDir(owner, repo, path = '', ref = '') {
    assertContentRepo(repo);
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const suffix = path ? `/${encodePath(path)}` : '';
    const { data } = await this.request(`${repoBase(owner, repo)}/contents${suffix}${query}`);
    if (!Array.isArray(data)) throw new GitHubError('该路径不是目录。');
    return data
      .map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        downloadUrl: item.download_url,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }

  async loadFile(owner, repo, path, ref = '') {
    assertContentRepo(repo);
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const { data } = await this.request(`${repoBase(owner, repo)}/contents/${encodePath(path)}${query}`);
    if (Array.isArray(data)) throw new GitHubError('该路径是目录，不是文件。');
    if (data.size > 1024 * 1024) throw new GitHubError('文件超过 1 MB，请在本地编辑器中打开。');
    if (!data.content && data.encoding !== 'base64') {
      throw new GitHubError('无法通过 Contents API 读取该文件（可能过大）。');
    }
    return {
      text: base64ToUtf8(data.content || ''),
      sha: data.sha,
      size: data.size,
      path: data.path,
      encoding: data.encoding,
    };
  }

  async getTree(owner, repo, ref) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/trees/${encodeRef(ref)}?recursive=1`);
    return data.tree || [];
  }

  async createRef(owner, repo, branch, sha) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha },
    });
    return data;
  }

  async updateRef(owner, repo, branch, sha) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/refs/heads/${encodeRef(branch)}`, {
      method: 'PATCH',
      body: { sha, force: false },
    });
    return data;
  }

  async createBlob(owner, repo, contentBase64) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/blobs`, {
      method: 'POST',
      body: { content: contentBase64, encoding: 'base64' },
    });
    return data.sha;
  }

  async createTree(owner, repo, baseTree, entries) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseTree, tree: entries },
    });
    return data.sha;
  }

  async createCommit(owner, repo, message, tree, parents) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/git/commits`, {
      method: 'POST',
      body: { message, tree, parents },
    });
    return data.sha;
  }

  async createPullRequest(owner, repo, payload) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/pulls`, {
      method: 'POST',
      body: payload,
    });
    return data;
  }

  async findOpenPullRequest(owner, repo, head) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/pulls?state=open&head=${encodeURIComponent(head)}`);
    return Array.isArray(data) ? data[0] : null;
  }

  /** Single pull request (state, mergeable, counts). */
  async getPull(owner, repo, number) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/pulls/${Number(number)}`);
    return data;
  }

  /** Reviews submitted on a pull request (one entry per reviewer action). */
  async listPullReviews(owner, repo, number) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/pulls/${Number(number)}/reviews?per_page=100`);
    return Array.isArray(data) ? data : [];
  }

  /** Issue comments on the pull request conversation. */
  async listPullComments(owner, repo, number) {
    assertContentRepo(repo);
    const { data } = await this.request(`${repoBase(owner, repo)}/issues/${Number(number)}/comments?per_page=100`);
    return Array.isArray(data) ? data : [];
  }

  async ensureFork(owner, repo, login, onProgress) {
    assertContentRepo(repo);
    onProgress('创建 / 检查 Fork…');
    try {
      await this.request(`${repoBase(owner, repo)}/forks`, {
        method: 'POST',
        body: { default_branch_only: true },
      });
    } catch (error) {
      if (!(error instanceof GitHubError && error.status === 422)) throw error;
      // Fork already exists.
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const fork = await this.getRepo(login, repo);
        if (fork) return fork;
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 404)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new GitHubError('Fork 创建超时，请稍后重试。');
  }

  async syncFork(owner, repo, branch) {
    assertContentRepo(repo);
    try {
      await this.request(`${repoBase(owner, repo)}/merge-upstream`, {
        method: 'POST',
        body: { branch },
      });
    } catch (error) {
      // A fork without divergent commits is already up to date; 409/422 is not fatal.
      if (!(error instanceof GitHubError && [409, 422].includes(error.status))) throw error;
    }
  }

  /**
   * Create a branch, commit all files and open a pull request.
   *
   * The submission is journaled stage by stage. If the previous attempt died
   * after the branch was created (network drop, PR request timeout), retrying
   * with the same branch resumes from the recorded stage instead of failing
   * with "branch already exists" or duplicating the PR.
   *
   * @param {object} options
   * @param {string} options.owner upstream owner
   * @param {string} options.repo upstream repository
   * @param {string} [options.baseBranch]
   * @param {string} options.branchName
   * @param {Array<{path:string,text?:string,base64?:string,deleted?:boolean}>} options.files
   * @param {string} options.commitMessage
   * @param {string} options.prTitle
   * @param {string} options.prBody
   * @param {boolean} [options.draft]
   * @param {(message:string, kind?:string) => void} [options.onProgress]
   * @param {object} [options.journal] injected journal (tests / alternative storage)
   */
  async submitPullRequest(options) {
    const {
      owner,
      repo,
      baseBranch,
      branchName,
      files,
      commitMessage,
      prTitle,
      prBody,
      draft = false,
      onProgress = () => {},
      journal = submitJournal,
    } = options;

    assertContentRepo(repo);
    if (!this.token) throw new GitHubError('请先在设置中填写 GitHub token。');
    if (!files?.length) throw new GitHubError('没有需要提交的文件。');

    const user = await this.getUser();
    onProgress(`已登录：${user.login}`, 'ok');

    const repoInfo = await this.getRepo(owner, repo);
    const base = baseBranch || repoInfo.default_branch;
    onProgress(`目标仓库：${owner}/${repo}（默认分支 ${base}）`, 'ok');

    const branch = branchName;
    let resume = resumableEntry(journal?.read?.(), { owner, repo, branch });
    let headOwner = resume?.headOwner || owner;
    let forkUsed = Boolean(resume?.forkUsed);
    let baseSha = resume?.baseSha || '';
    let baseCommit = null;

    const save = (patch) => {
      try {
        journal?.write?.({
          owner,
          repo,
          base,
          branch,
          headOwner,
          forkUsed,
          baseSha,
          commitSha: '',
          prNumber: 0,
          commitMessage,
          stage: 'start',
          startedAt: resume?.startedAt || Date.now(),
          ...patch,
        });
      } catch {
        // Journaling is best effort; never fail the submission because of it.
      }
    };

    if (resume) onProgress(`检测到上次未完成的提交（${resume.stage}），继续…`, 'step');

    // Reuse the branch from an earlier attempt when it still exists.
    let branchSha = '';
    if (resume) {
      try {
        const ref = await this.getRef(headOwner, repo, branch);
        branchSha = ref.object.sha;
        onProgress(`复用上次创建的分支 ${branch}`, 'ok');
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 404)) throw error;
        onProgress('上次创建的分支已不存在，重新开始提交…', 'step');
        resume = null;
        headOwner = owner;
        forkUsed = false;
      }
    }

    if (!branchSha && !resume) {
      const baseRef = await this.getRef(owner, repo, base);
      baseSha = baseRef.object.sha;
      baseCommit = await this.getCommit(owner, repo, baseSha);
      onProgress(`基线提交：${baseSha.slice(0, 8)}`, 'ok');

      // Try to create the branch directly on the upstream repository.
      // Never auto-rename a conflicting branch: the UI asks the user to choose.
      let directBranch = false;
      try {
        await this.createRef(owner, repo, branch, baseSha);
        directBranch = true;
        save({ stage: 'branch', baseSha });
        onProgress(`已在 ${owner}/${repo} 创建分支 ${branch}`, 'ok');
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        if (error.status === 422 && /exists/i.test(error.message)) {
          journal?.clear?.();
          throw new GitHubError(`分支名「${branch}」已存在，可能由其他贡献者创建。请更换分支名后重试。`, 422, {
            code: 'BRANCH_EXISTS',
            branch,
            owner,
          });
        }
        if ([403, 404].includes(error.status)) {
          onProgress('没有上游仓库写权限，切换到 Fork 流程…', 'step');
        } else {
          throw error;
        }
      }

      if (!directBranch) {
        await this.ensureFork(owner, repo, user.login, onProgress);
        forkUsed = true;
        headOwner = user.login;
        onProgress(`使用 Fork：${headOwner}/${repo}`, 'ok');

        await this.syncFork(headOwner, repo, base);
        const forkRef = await this.getRef(headOwner, repo, base);
        baseSha = forkRef.object.sha;
        baseCommit = await this.getCommit(headOwner, repo, baseSha);
        onProgress(`Fork 已同步到 ${baseSha.slice(0, 8)}`, 'ok');

        try {
          await this.createRef(headOwner, repo, branch, baseSha);
          save({ stage: 'branch', baseSha });
          onProgress(`已在 Fork 创建分支 ${branch}`, 'ok');
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          if (error.status === 422 && /exists/i.test(error.message)) {
            journal?.clear?.();
            throw new GitHubError(
              `分支名「${branch}」已存在于你的 Fork（${headOwner}/${repo}）。请更换分支名后重试。`,
              422,
              { code: 'BRANCH_EXISTS', branch, owner: headOwner },
            );
          }
          throw error;
        }
      }
      branchSha = baseSha;
    }

    // On resume the branch tip may already contain the commit from last time.
    const alreadyCommitted = Boolean(resume?.commitSha && resume.commitSha === branchSha);
    const parentSha = branchSha;
    const parentCommit = alreadyCommitted ? null : (baseCommit ?? (await this.getCommit(headOwner, repo, parentSha)));
    let commitSha = alreadyCommitted ? branchSha : '';

    if (alreadyCommitted) {
      onProgress('上次的提交已存在，直接创建 Pull Request…', 'ok');
    } else {
      const treeEntries = [];
      for (const file of files) {
        const path = file.path.replace(/^\/+/, '');
        if (file.deleted) {
          onProgress(`删除文件：${path}`, 'step');
          treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        onProgress(`上传文件：${file.path}`, 'step');
        const content = file.base64 ?? utf8ToBase64(file.text ?? '');
        const blobSha = await this.createBlob(headOwner, repo, content);
        treeEntries.push({ path, mode: '100644', type: 'blob', sha: blobSha });
      }

      onProgress('创建 Git tree…', 'step');
      const treeSha = await this.createTree(headOwner, repo, parentCommit.tree.sha, treeEntries);
      onProgress('创建提交…', 'step');
      commitSha = await this.createCommit(headOwner, repo, commitMessage, treeSha, [parentSha]);
      save({ stage: 'committed', baseSha: parentSha, commitSha });
      onProgress('更新分支引用…', 'step');
      await this.updateRef(headOwner, repo, branch, commitSha);
    }
    save({ stage: 'pr-pending', baseSha: parentSha, commitSha });

    const done = (pr) => {
      journal?.clear?.();
      return {
        url: pr.html_url,
        number: pr.number,
        branch,
        forkUsed,
        headOwner,
        login: user.login,
        scopes: user.scopes,
      };
    };

    const headQuery = `${forkUsed ? headOwner : owner}:${branch}`;
    const head = forkUsed ? `${headOwner}:${branch}` : branch;

    // A previous attempt may have opened the PR even though the response was
    // lost. Look it up before creating a duplicate.
    if (resume?.prNumber) {
      try {
        const pr = await this.getPull(owner, repo, resume.prNumber);
        onProgress(`上次的 PR #${pr.number} 已创建，直接返回。`, 'ok');
        return done(pr);
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 404)) throw error;
      }
    }
    const existing = await this.findOpenPullRequest(owner, repo, headQuery);
    if (existing) {
      onProgress(`已存在相同分支的 PR #${existing.number}，直接返回。`, 'ok');
      return done(existing);
    }

    onProgress(`创建 Pull Request（${head} → ${base}）…`, 'step');
    let pr;
    try {
      pr = await this.createPullRequest(owner, repo, {
        title: prTitle,
        head,
        base,
        body: prBody,
        draft,
      });
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422 && /already exists/i.test(error.message)) {
        pr = await this.findOpenPullRequest(owner, repo, headQuery);
        if (!pr) throw error;
        onProgress('已存在相同分支的 PR，返回现有 PR。', 'ok');
      } else {
        throw error;
      }
    }

    save({ stage: 'pr-pending', baseSha: parentSha, commitSha, prNumber: pr.number });
    return done(pr);
  }
}
