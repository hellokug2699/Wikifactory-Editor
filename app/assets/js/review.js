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

/**
 * Turn a `GET /pulls/:n` response into what the review panel shows.
 * @param {{pull: object, reviews?: Array<object>}} options
 */
export function summarizeReview({ pull, reviews = [] }) {
  const counts = reviewCounts(reviews);
  const state = pull?.merged
    ? 'merged'
    : pull?.state === 'closed'
      ? 'closed'
      : pull?.mergeable === false
        ? 'conflict'
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
    headline: headlineFor(state),
    needsAction: ['changes_requested', 'conflict', 'closed'].includes(state),
  };
}

function headlineFor(state) {
  if (state === 'merged') return '已合并';
  if (state === 'closed') return '已关闭（未合并）';
  if (state === 'conflict') return '存在冲突，需要先同步目标分支';
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
