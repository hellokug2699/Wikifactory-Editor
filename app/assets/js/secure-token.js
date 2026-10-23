/** Encrypted token storage.
 *
 * A token has to be recoverable to be reused, so a plain hash cannot work.
 * Instead the token is encrypted at rest:
 *
 * - Android shell: AES-GCM key generated inside the Android Keystore and never
 *   leaves it (non-exportable, hardware-backed when available). Ciphertext is
 *   stored in SharedPreferences through the `AndroidEditor` bridge.
 * - Web / desktop: AES-256-GCM via WebCrypto, with a PBKDF2 key derived from a
 *   per-install identifier plus stable device properties. This keeps the token
 *   unreadable as plaintext, but anyone who can run code in the origin can
 *   still recover it, so it is obfuscation rather than a hardware boundary.
 */

const STORE_KEY = 'wikifactory-editor:token:v1';
const INSTALL_KEY = 'wikifactory-editor:install-id:v1';
const SALT_PREFIX = 'wikifactory-editor/token-store/v1';
const PBKDF2_ITERATIONS = 210000;

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

/** Stable, non-secret device properties; used only as key-derivation material. */
function deviceMaterial() {
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

async function deriveKey() {
  const material = encoder.encode(`${SALT_PREFIX}|${installId()}|${deviceMaterial()}`);
  const baseKey = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  const record = {
    v: 1,
    kind: 'webcrypto',
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
    savedAt: payload.savedAt,
    login: payload.login || '',
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(record));
}

async function loadWithWebCrypto() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORE_KEY);
    return null;
  }
  if (!record || record.kind !== 'webcrypto' || !record.iv || !record.data) return null;
  try {
    const key = await deriveKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.data),
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    // Device changed, browser upgraded or record was tampered with: drop it.
    localStorage.removeItem(STORE_KEY);
    return null;
  }
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
