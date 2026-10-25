import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGuidance,
  checksLabel,
  commentSummary,
  mergeGuidance,
  reviewCounts,
  reviewLabel,
  reviewStateOf,
  summarizeChecks,
  summarizeReview,
} from '../app/assets/js/review.js';

const reviews = [
  { state: 'APPROVED', user: 'a' },
  { state: 'COMMENTED', user: 'b' },
  { state: 'CHANGES_REQUESTED', user: 'c' },
  { state: 'PENDING', user: 'd' },
];

test('review counts and priority are derived from reviewer states', () => {
  assert.deepEqual(reviewCounts(reviews), { approved: 1, changesRequested: 1, commented: 1, pending: 1 });
  assert.equal(reviewStateOf(reviews), 'changes_requested');
  assert.equal(reviewStateOf([{ state: 'APPROVED' }]), 'approved');
  assert.equal(reviewStateOf([{ state: 'COMMENTED' }]), 'commented');
  assert.equal(reviewStateOf([]), 'pending');
  assert.equal(reviewLabel('approved'), '已批准');
});

test('summary covers state, mergeability and counts', () => {
  const pull = {
    state: 'open',
    merged: false,
    draft: false,
    mergeable: false,
    mergeable_state: 'dirty',
    comments: 3,
    review_comments: 5,
    commits: 2,
    changed_files: 4,
    additions: 10,
    deletions: 2,
  };
  const summary = summarizeReview({ pull, reviews });
  assert.equal(summary.state, 'conflict');
  assert.equal(summary.needsAction, true);
  assert.equal(summary.comments, 3);
  assert.equal(summary.reviewComments, 5);
  assert.match(summary.headline, /冲突/);
  assert.match(commentSummary(summary), /评论 3 条/);
});

test('merged and closed pull requests are terminal states', () => {
  assert.equal(summarizeReview({ pull: { merged: true, state: 'closed' } }).state, 'merged');
  assert.equal(summarizeReview({ pull: { merged: false, state: 'closed' } }).state, 'closed');
  assert.equal(summarizeReview({ pull: { state: 'open', mergeable: true } }).state, 'pending');
});

test('check runs distinguish passing, pending and failing states', () => {
  const passing = summarizeChecks({
    checkRuns: [
      { name: 'validate', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'skipped' },
    ],
  });
  assert.equal(passing.state, 'passing');
  assert.equal(passing.total, 2);
  assert.equal(checksLabel(passing), '全部通过（2 项）');

  const pending = summarizeChecks({
    checkRuns: [
      { name: 'validate', status: 'in_progress', conclusion: '' },
      { name: 'lint', status: 'completed', conclusion: 'success' },
    ],
  });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.pending, 1);
  assert.match(checksLabel(pending), /进行中/);

  const failing = summarizeChecks({
    checkRuns: [
      { name: 'Validate content', status: 'completed', conclusion: 'failure', html_url: 'https://x/1' },
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'build', status: 'completed', conclusion: 'cancelled' },
    ],
  });
  assert.equal(failing.state, 'failing');
  assert.equal(failing.failed.length, 2);
  assert.equal(failing.failed[0].name, 'Validate content');
  assert.equal(failing.failed[0].url, 'https://x/1');
  assert.match(checksLabel(failing), /2 项未通过/);

  assert.equal(summarizeChecks({ checkRuns: [] }).state, 'none');
  assert.equal(checksLabel(null), '尚未报告');
});

test('failing required checks become the blocking PR state', () => {
  const pull = { state: 'open', mergeable: true, mergeable_state: 'blocked' };
  const approved = [{ state: 'APPROVED', user: 'a' }];
  const checks = summarizeChecks({
    checkRuns: [{ name: 'Validate content', status: 'completed', conclusion: 'failure' }],
  });
  const summary = summarizeReview({ pull, reviews: approved, checks });
  assert.equal(summary.state, 'checks_failed');
  assert.equal(summary.needsAction, true);
  assert.match(summary.headline, /检查未通过/);
  assert.equal(summary.checksLabel, '1 项未通过（共 1 项）');

  // Without checks the approval still decides the headline.
  assert.equal(summarizeReview({ pull, reviews: approved }).state, 'approved');
});

test('check guidance points at the logs and the same branch', () => {
  const checks = summarizeChecks({
    checkRuns: [{ name: 'Validate content', status: 'completed', conclusion: 'failure', html_url: 'https://x/1' }],
  });
  const guidance = checkGuidance({ checks, headRef: 'wfe/page-1' });
  assert.match(guidance.title, /无法合并/);
  assert.equal(guidance.failed.length, 1);
  assert.ok(guidance.steps.some((step) => step.includes('npm run content:validate')));
  assert.ok(guidance.steps.some((step) => step.includes('wfe/page-1')));
  assert.ok(guidance.steps.some((step) => step.includes('更新已有分支')));
  assert.ok(guidance.webAlternative.includes('GitHub'));
});

test('conflict guidance gives real git steps instead of renaming the branch', () => {
  const guidance = mergeGuidance({ headRef: 'wfe/page-1', baseRef: 'main', forkOwner: 'me', upstream: 'upstream' });
  assert.match(guidance.summary, /换一个分支名/);
  assert.ok(guidance.steps.some((step) => step.includes('git merge upstream/main')));
  assert.ok(guidance.rebaseAlternative.some((step) => step.includes('git rebase upstream/main')));
  assert.ok(guidance.rebaseAlternative.some((step) => step.includes('push --force-with-lease')));
  assert.ok(guidance.webAlternative.includes('Resolve conflicts'));
  // Defaults keep the steps usable even without a head ref.
  const fallback = mergeGuidance();
  assert.ok(fallback.steps[0].includes('upstream'));
  assert.ok(fallback.steps[1].includes('main'));
});
