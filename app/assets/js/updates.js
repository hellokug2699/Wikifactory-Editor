/** Update policy helpers (pure): version comparison, release assets, mode decisions. */

export const UPDATE_MODES = [
  { value: 0, label: '0 · 有新版本时自动下载' },
  { value: 1, label: '1 · 提示后手动下载（默认）' },
  { value: 2, label: '2 · 不检查更新' },
];

export function parseVersion(value) {
  const parts = String(value || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function releaseAsset(release, suffix) {
  return (release?.assets || []).find((asset) => String(asset.name || '').endsWith(suffix)) || null;
}

/**
 * @param {{mode:number, manual:boolean, platform:'desktop'|'android'|'web', latest:string, current:string}} options
 * @returns {'skip'|'auto'|'prompt'|'none'}
 */
export function planUpdate({ mode, manual = false, platform, latest, current }) {
  const normalized = [0, 1, 2].includes(Number(mode)) ? Number(mode) : 1;
  if (!manual && normalized === 2) return 'skip';
  if (!latest) return 'none';
  if (compareVersions(latest, current) <= 0) return 'none';
  if (!manual && normalized === 0)
    return platform === 'web' || platform === 'desktop' || platform === 'android' ? 'auto' : 'prompt';
  return 'prompt';
}

export function desktopManifestUrl(owner, repo) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/updates/desktop.json`;
}
