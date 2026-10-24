import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentSummary,
  mergeGuidance,
  reviewCounts,
  reviewLabel,
  reviewStateOf,
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
