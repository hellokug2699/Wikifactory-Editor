/** Bounded-concurrency helpers for network batches. */

/**
 * Run `worker` over `items` with at most `limit` concurrent calls.
 * Results keep the input order; a thrown error rejects the whole batch.
 *
 * @template T, R
 * @param {Iterable<T>} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  const size = Math.max(1, Math.min(Math.floor(Number(limit) || 1), list.length || 1));
  let next = 0;

  async function run() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return results;
}
