/**
 * Content license agreement gate.
 *
 * The site distributes content under CC BY-NC-SA 4.0. Before a PR is created
 * the contributor must read and accept the rules; "不再提示" remembers that on
 * this device only (localStorage), never in the repository or the account.
 */

export const AGREEMENT_KEY = 'wikifactory-editor:content-license:v1';
export const CC_LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans';
export const CC_LICENSE_NAME = 'CC BY-NC-SA 4.0';

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

/** @returns {boolean} true when this device already accepted the agreement. */
export function hasAcceptedLicense(storage) {
  try {
    return storageOrDefault(storage).getItem(AGREEMENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** Remember the acceptance on this device. */
export function rememberLicense(storage) {
  try {
    storageOrDefault(storage).setItem(AGREEMENT_KEY, 'yes');
    return true;
  } catch {
    return false;
  }
}

/** Text blocks rendered by the dialog (kept here so they can be tested). */
export function licenseNotices() {
  return {
    title: '提交前请阅读权利规则',
    intro: `本站使用 ${CC_LICENSE_NAME} 协议分发内容。提交 PR 前，请先阅读该协议，了解你的权利与义务。`,
    points: [
      '如果你的页面包含来自其他网站、且该网站有独立许可协议的内容，应当在正文中以注释形式显式声明来源与许可，并遵循对应的许可协议进行注释。',
      'PR 提交后、合并前，你有权随时取消。本站不会使用未提交的页面内容；但这不代表本站不会采用其他人提交的同页面内容，也不排除他人创建相关页面。',
      'PR 合并后，你将无法以「本站合法使用」为由删除已提交的页面信息，也无权要求本站删除相关信息，除非其他贡献者对其作出合理变更。',
    ],
    remember: '不再提示（仅当前设备）',
    accept: '同意并继续',
    cancel: '取消',
  };
}
