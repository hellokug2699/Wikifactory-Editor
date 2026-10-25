/** PR review status helpers (pure): review state, comment counts, conflict guidance. */

const REVIEW_STATE_LABELS = {
  approved: '已批准',
  changes_requested: '有人要求修改',
  commented: '有评论待查看',
  pending: '等待审阅',
};

export function reviewCounts(reviews = []) {
  const counts = { approved: 0, changesRequested: 0, commented: 0, pending: 0 };
  for (const review of reviews || []) {
    const state = String(review?.state || '').toUpperCase();
    if (state === 'APPROVED') counts.approved += 1;
    else if (state === 'CHANGES_REQUESTED') counts.changesRequested += 1;
    else if (state === 'COMMENTED') counts.commented += 1;
    else counts.pending += 1;
  }
  return counts;
}

/** Most actionable review state across all reviewers. */
export function reviewStateOf(reviews = []) {
  const counts = reviewCounts(reviews);
  if (counts.changesRequested > 0) return 'changes_requested';
  if (counts.approved > 0) return 'approved';
  if (counts.commented > 0) return 'commented';
  return 'pending';
}

export function reviewLabel(state) {
  return REVIEW_STATE_LABELS[state] || REVIEW_STATE_LABELS.pending;
}

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

/**
 * Turn check runs (`GET /commits/:ref/check-runs`) into a merge-relevant
 * summary. A repository that requires status checks cannot merge while any
 * required check is failing or still running.
 *
 * @param {{checkRuns?: Array<object>}} options
 */
export function summarizeChecks({ checkRuns = [] } = {}) {
  const runs = (Array.isArray(checkRuns) ? checkRuns : []).map((run) => ({
    name: String(run?.name || ''),
    status: String(run?.status || ''),
    conclusion: String(run?.conclusion || ''),
    url: String(run?.html_url || run?.details_url || ''),
  }));
  const failed = runs.filter((run) => run.status === 'completed' && FAILED_CONCLUSIONS.has(run.conclusion));
  const pending = runs.filter((run) => run.status !== 'completed');
  const passed = runs.filter((run) => run.status === 'completed' && !FAILED_CONCLUSIONS.has(run.conclusion));
  const state = failed.length ? 'failing' : pending.length ? 'pending' : runs.length ? 'passing' : 'none';
  return {
    state,
    total: runs.length,
    passed: passed.length,
    pending: pending.length,
    failed: failed.map((run) => ({ name: run.name, url: run.url, conclusion: run.conclusion })),
  };
}

/** One-line check summary for the review card. */
export function checksLabel(checks) {
  if (!checks || checks.state === 'none') return '尚未报告';
  if (checks.state === 'failing') return `${checks.failed.length} 项未通过（共 ${checks.total} 项）`;
  if (checks.state === 'pending') return `${checks.pending} 项进行中（共 ${checks.total} 项）`;
  return `全部通过（${checks.total} 项）`;
}

/**
 * What to do when a required check blocks the merge.
 * @param {{checks?: object, headRef?: string}} options
 */
export function checkGuidance({ checks, headRef = '' } = {}) {
  const branch = headRef || '<PR 分支>';
  return {
    title: '自动检查未通过：PR 暂时无法合并',
    summary:
      '仓库要求所有必需的状态检查通过后才能合并。检查失败不影响 PR 保留；按下面步骤修复并追加提交后，检查会自动重跑。',
    failed: (checks?.failed || []).filter((item) => item.name),
    steps: [
      '点开上方失败的检查，查看 GitHub Actions 日志，确认是哪一步失败。',
      '常见原因：目录层级不对、frontmatter 字段类型错误、重复 URL / 大小写冲突、使用了保留路径、图标或图片缺失、站内链接目标不存在。',
      '先在本地自查：npm install && npm run content:validate（在内容仓库根目录执行）。',
      `按日志修复页面，然后回到编辑器重新提交：分支名填写「${branch}」并勾选「更新已有分支」（或直接点「填入当前 PR 分支」），即可在同一个 PR 追加提交。`,
      '若失败与本次内容无关（基础设施故障、权限或配额问题），请在 PR 页面让维护者重新运行检查。',
    ],
    webAlternative: '也可以直接在 GitHub 的 PR 页面编辑文件并提交到该分支，检查会自动重新运行。',
  };
}

/**
 * Turn a `GET /pulls/:n` response into what the review panel shows.
 * @param {{pull: object, reviews?: Array<object>, checks?: object}} options
 */
export function summarizeReview({ pull, reviews = [], checks = null }) {
  const counts = reviewCounts(reviews);
  const checksState = checks?.state || 'none';
  const state = pull?.merged
    ? 'merged'
    : pull?.state === 'closed'
      ? 'closed'
      : pull?.mergeable === false
        ? 'conflict'
        : checksState === 'failing'
          ? 'checks_failed'
          : reviewStateOf(reviews);
  return {
    state,
    merged: Boolean(pull?.merged),
    draft: Boolean(pull?.draft),
    mergeable: pull?.mergeable,
    mergeableState: pull?.mergeable_state || '',
    comments: Number(pull?.comments ?? 0),
    reviewComments: Number(pull?.review_comments ?? 0),
    commits: Number(pull?.commits ?? 0),
    changedFiles: Number(pull?.changed_files ?? 0),
    additions: Number(pull?.additions ?? 0),
    deletions: Number(pull?.deletions ?? 0),
    reviewState: reviewStateOf(reviews),
    reviewLabel: reviewLabel(reviewStateOf(reviews)),
    counts,
    checks,
    checksLabel: checksLabel(checks),
    headline: headlineFor(state),
    needsAction: ['changes_requested', 'conflict', 'closed', 'checks_failed'].includes(state),
  };
}

function headlineFor(state) {
  if (state === 'merged') return '已合并';
  if (state === 'closed') return '已关闭（未合并）';
  if (state === 'conflict') return '存在冲突，需要先同步目标分支';
  if (state === 'checks_failed') return '自动检查未通过，PR 暂时无法合并';
  if (state === 'approved') return '已获批准，可以合并';
  if (state === 'changes_requested') return '维护者要求修改';
  if (state === 'commented') return '有审阅评论待处理';
  return '等待维护者审阅';
}

/**
 * Conflict / out-of-date guidance. The editor cannot resolve merge conflicts
 * (that needs a real git client), so it prints exact commands instead of
 * pretending another branch name would help.
 */
export function mergeGuidance({ headRef = '', baseRef = 'main', forkOwner = '', upstream = '' } = {}) {
  const head = headRef || '<你的分支>';
  const remote = forkOwner || 'origin';
  const upstreamRemote = upstream || 'upstream';
  return {
    title: '冲突 / 分支落后时的处理方式',
    summary: '换一个分支名只会新建一个 PR，冲突仍然存在。正确做法是把目标分支的改动同步到你的分支，解决冲突后再推送。',
    steps: [
      `在本地检出 PR 分支：git fetch ${upstreamRemote} && git checkout ${head}`,
      `把 ${baseRef} 的最新改动合并进来：git merge ${upstreamRemote}/${baseRef}`,
      '按提示解决冲突文件（保留双方需要的段落，删除 <<<<<<< / ======= / >>>>>>> 标记）',
      'git add <冲突文件> && git commit（merge 会自动生成提交信息）',
      `git push ${remote} ${head}，PR 会自动更新，无需新建 PR`,
    ],
    rebaseAlternative: [
      `git fetch ${upstreamRemote} && git checkout ${head}`,
      `git rebase ${upstreamRemote}/${baseRef}`,
      'git add <冲突文件> && git rebase --continue',
      `git push --force-with-lease ${remote} ${head}`,
    ],
    webAlternative:
      '也可以在 GitHub PR 页面点击「Resolve conflicts」在线解决；或点击「Update branch」把目标分支合并进本分支（需要写权限）。',
  };
}

export function commentSummary(summary) {
  return `评论 ${summary.comments} 条 · 审阅评论 ${summary.reviewComments} 条 · ${summary.commits} 个提交`;
}
