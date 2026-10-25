/**
 * Network reachability for the two header lights.
 *
 * - "local" comes from the Android bridge when present (`isNetworkAvailable()`,
 *   backed by ConnectivityManager) and falls back to `navigator.onLine`.
 * - "github" is an actual probe of api.github.com, so it says whether this
 *   device can reach GitHub right now — not merely whether a cable is plugged
 *   in. Any HTTP answer below 500 counts as reachable; the light reports
 *   "can't reach GitHub", not "the API returned an error".
 *
 * Nothing here imports github.js: the GitHub client reports failures through
 * `notifyGithubUnreachable`, and the UI decides when to re-probe.
 */

export const NET = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  OK: 'ok',
  DOWN: 'down',
};

export const GITHUB_PROBE_URL = 'https://api.github.com/rate_limit';
const DEFAULT_TIMEOUT = 6000;

/** Normalize whatever the bridge returned into a state, or null if unknown. */
function fromBridge(value) {
  if (value === true || value === 'true' || value === 1) return NET.OK;
  if (value === false || value === 'false' || value === 0) return NET.DOWN;
  return null;
}

export function androidNetworkState(api = globalThis.AndroidEditor) {
  try {
    if (typeof api?.isNetworkAvailable !== 'function') return null;
    return fromBridge(api.isNetworkAvailable());
  } catch {
    return null;
  }
}

/**
 * Local network state without any request.
 * @returns {'ok'|'down'|'unknown'}
 */
export function localNetworkState({ api = globalThis.AndroidEditor, nav = globalThis.navigator } = {}) {
  const android = androidNetworkState(api);
  if (android) return android;
  if (typeof nav?.onLine === 'boolean') return nav.onLine ? NET.OK : NET.DOWN;
  return NET.UNKNOWN;
}

function fetchWithTimeout(fetchImpl, url, options, timeout) {
  if (typeof AbortController === 'undefined') return fetchImpl(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return Promise.resolve(fetchImpl(url, { ...options, signal: controller.signal })).finally(() => clearTimeout(timer));
}

/**
 * Probe api.github.com. Any response below 500 means GitHub is reachable; a
 * thrown error or a 5xx means it is not.
 *
 * @returns {Promise<{state:'ok'|'down', status:number, latency:number, checkedAt:number, error?:string}>}
 */
export async function probeGithub({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeout = DEFAULT_TIMEOUT,
  now = () => Date.now(),
} = {}) {
  const started = now();
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      GITHUB_PROBE_URL,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
      },
      timeout,
    );
    const status = Number(response?.status) || 0;
    return {
      state: status > 0 && status < 500 ? NET.OK : NET.DOWN,
      status,
      latency: now() - started,
      checkedAt: now(),
    };
  } catch (error) {
    return {
      state: NET.DOWN,
      status: 0,
      latency: now() - started,
      checkedAt: now(),
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
    };
  }
}

/* ------------------------------------------------------------ error signal */

const listeners = new Set();

/** Subscribe to GitHub request failures; returns an unsubscribe function. */
export function onGithubUnreachable(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Called by the GitHub client when a request fails in a way that may be a
 * connectivity problem (status 0 / 5xx). The UI re-probes rather than
 * painting the light red on a guess.
 */
export function notifyGithubUnreachable(error) {
  for (const listener of listeners) {
    try {
      listener(error);
    } catch {
      // A broken listener must never mask the original GitHub error.
    }
  }
}
