/**
 * Submission journal.
 *
 * A pull request is several GitHub calls, not one transaction: create branch,
 * upload blobs, create tree, create commit, update the ref, open the PR. A
 * network failure in the middle leaves real objects behind, and a timeout while
 * opening the PR leaves the user unsure whether it exists.
 *
 * The journal records the branch and the last completed stage, so a retry can
 * resume instead of starting over (or failing with "branch already exists").
 */

const JOURNAL_KEY = 'wikifactory-editor:submit-journal:v1';

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

/**
 * @param {{storage?: Storage, key?: string}} [options]
 */
export function createSubmitJournal({ storage, key = JOURNAL_KEY } = {}) {
  const read = () => {
    try {
      const raw = storageOrDefault(storage).getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.branch ? parsed : null;
    } catch {
      return null;
    }
  };

  return {
    key,
    read,
    write(entry) {
      try {
        storageOrDefault(storage).setItem(key, JSON.stringify({ ...entry, updatedAt: Date.now() }));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storageOrDefault(storage).removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const submitJournal = createSubmitJournal();

/**
 * Whether the journal describes an unfinished submission that a retry can pick
 * up for the same repository, branch and head.
 */
export function resumableEntry(entry, { owner, repo, branch }) {
  if (!entry || !entry.branch || !entry.stage) return null;
  if (entry.owner !== owner || entry.repo !== repo || entry.branch !== branch) return null;
  if (!['branch', 'committed', 'pr-pending'].includes(entry.stage)) return null;
  return entry;
}
