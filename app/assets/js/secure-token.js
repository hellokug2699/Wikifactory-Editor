/** Encrypted token storage.
 *
 * A token has to be recoverable to be reused, so a plain hash cannot work.
 * Instead the token is encrypted at rest:
 *
 * - Android shell: AES-GCM key generated inside the Android Keystore and never
 *   leaves it (non-exportable, hardware-backed when available). Ciphertext is
 *   stored in SharedPreferences through the `AndroidEditor` bridge.
 * - Web / desktop: AES-256-GCM via WebCrypto, with a PBKDF2 key derived from a
 *   per-install identifier. This keeps the token unreadable as plaintext, but
 *   anyone who can run code in the origin can still recover it, so it is
 *   obfuscation rather than a hardware boundary. Windows desktop should use
 *   the OS credential store once the shell exposes one.
 *
 * The key material is deliberately limited to the per-install id: language,
 * screen size, timezone and user agent used to be mixed in, which meant a
 * system-language change or a browser upgrade made the stored token
 * undecryptable. Those properties are kept only to read v1 records.
 */

const STORE_KEY = 'wikifactory-editor:token:v1';
const INSTALL_KEY = 'wikifactory-editor:install-id:v1';
const UNREADABLE_KEY = 'wikifactory-editor:token:v1:unreadable';
const SALT_PREFIX = 'wikifactory-editor/token-store/v1';
const PBKDF2_ITERATIONS = 210000;
const KEY_VERSION = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function androidBridge() {
  const api = globalThis.AndroidEditor;
  if (!api || typeof api.secureGet !== 'function') return null;
  return api;
}

export function tokenStorageKind() {
  if (androidBridge()) return 'android-keystore';
  if (globalThis.crypto?.subtle) return 'webcrypto';
  return 'unavailable';
}

/** True when a stored record exists but this install cannot decrypt it. */
export function tokenStoreUnreadable() {
  try {
    return localStorage.getItem(UNREADABLE_KEY) === '1';
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBase64(size = 18) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function installId() {
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (!id) {
      id = randomBase64(24);
      localStorage.setItem(INSTALL_KEY, id);
    }
    return id;
  } catch {
    return 'no-local-storage';
  }
}

/** Properties mixed into v1 keys only; volatile, so no longer used. */
function legacyDeviceMaterial() {
  const nav = navigator;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return [
    nav.userAgent,
    nav.platform || '',
    nav.language || '',
    (nav.languages || []).join(','),
    `${screen.width}x${screen.height}`,
    tz,
    nav.hardwareConcurrency || 0,
  ].join('|');
}

async function deriveKey({ legacy = false } = {}) {
  const material = legacy ? `${SALT_PREFIX}|${installId()}|${legacyDeviceMaterial()}` : `${SALT_PREFIX}|${installId()}`;
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(material), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT_PREFIX),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function saveWithWebCrypto(payload) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  const record = {
    v: KEY_VERSION,
    kind: 'webcrypto',
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
    savedAt: payload.savedAt,
    login: payload.login || '',
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(record));
  localStorage.removeItem(UNREADABLE_KEY);
}

async function decryptRecord(record, { legacy }) {
  const key = await deriveKey({ legacy });
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.data),
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function loadWithWebCrypto() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  // A previous attempt already proved this record cannot be decrypted. Keep it
  // (it may be recoverable with an older build) but stop paying the PBKDF2 cost.
  if (localStorage.getItem(UNREADABLE_KEY) === '1') return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    localStorage.setItem(UNREADABLE_KEY, '1');
    return null;
  }
  if (!record || record.kind !== 'webcrypto' || !record.iv || !record.data) return null;

  // v1 records mixed volatile device properties into the key. Try the current
  // derivation first, then fall back once and upgrade the record.
  const attempts = Number(record.v) === KEY_VERSION ? [{ legacy: false }] : [{ legacy: false }, { legacy: true }];
  for (const attempt of attempts) {
    try {
      const payload = await decryptRecord(record, attempt);
      if (attempt.legacy) {
        try {
          await saveWithWebCrypto(payload);
        } catch {
          // Upgrading is best-effort; the token still works this session.
        }
      }
      return payload;
    } catch {
      // Try the next derivation.
    }
  }
  // Device / install id changed, or the record was tampered with: keep it for
  // manual inspection instead of deleting it, and ask the user to re-authorise.
  localStorage.setItem(UNREADABLE_KEY, '1');
  console.warn('[token] 本机保存的 token 无法解密，已保留记录；请重新填写 token。');
  return null;
}

/** @param {string} token @param {{login?: string}} meta */
export async function saveToken(token, meta = {}) {
  if (!token) return { ok: false, kind: tokenStorageKind(), reason: 'empty' };
  const payload = {
    token,
    login: meta.login || '',
    savedAt: Date.now(),
  };
  const bridge = androidBridge();
  if (bridge) {
    try {
      const written = bridge.secureSet(JSON.stringify(payload));
      return { ok: written === 'true' || written === true, kind: 'android-keystore' };
    } catch (error) {
      console.warn('[token] Keystore 保存失败', error);
      return { ok: false, kind: 'android-keystore', reason: error.message };
    }
  }
  if (!globalThis.crypto?.subtle) {
    return { ok: false, kind: 'unavailable', reason: 'WebCrypto 不可用' };
  }
  try {
    await saveWithWebCrypto(payload);
    return { ok: true, kind: 'webcrypto' };
  } catch (error) {
    console.warn('[token] 加密保存失败', error);
    return { ok: false, kind: 'webcrypto', reason: error.message };
  }
}

/** @returns {Promise<{token: string, login?: string, savedAt?: number}|null>} */
export async function loadToken() {
  const bridge = androidBridge();
  if (bridge) {
    try {
      const raw = bridge.secureGet();
      if (!raw) return null;
      const payload = JSON.parse(raw);
      return payload?.token ? payload : null;
    } catch (error) {
      console.warn('[token] Keystore 读取失败', error);
      return null;
    }
  }
  if (!globalThis.crypto?.subtle) return null;
  return loadWithWebCrypto();
}

export async function clearToken() {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(UNREADABLE_KEY);
  } catch {
    // Ignore.
  }
  const bridge = androidBridge();
  if (bridge) {
    try {
      bridge.secureClear();
    } catch (error) {
      console.warn('[token] Keystore 清除失败', error);
    }
  }
}
