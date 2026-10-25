/**
 * End-to-end smoke: 加载 → 编辑 → 检查 → 预览 → PR（GitHub API 全部 mock）。
 *
 *   node tests/e2e/main-flow.mjs
 *
 * Uses playwright-core with a locally cached Chromium (PW_CHROME overrides the path).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = path.join(root, 'app');
const editorConfig = JSON.parse(fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8'));
const OWNER = editorConfig.content.owner;
const REPO = editorConfig.content.repo;
const PAGE_PATH = 'games/Example/Guides/New-Page.md';

function browserCacheRoots() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return [process.env.PLAYWRIGHT_BROWSERS_PATH];
  const home = os.homedir();
  return [
    path.join(home, '.cache/ms-playwright'),
    path.join(home, 'Library/Caches/ms-playwright'),
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright'),
  ];
}

/** Binary layout differs by Playwright version and platform. */
function browserCandidates(cache) {
  const out = [];
  if (!fs.existsSync(cache)) return out;
  for (const entry of fs.readdirSync(cache)) {
    if (!/^chromium-/.test(entry)) continue;
    const base = path.join(cache, entry);
    out.push(
      path.join(base, 'chrome-linux64/chrome'),
      path.join(base, 'chrome-linux/chrome'),
      path.join(base, 'chrome-win64/chrome.exe'),
      path.join(base, 'chrome-win/chrome.exe'),
      path.join(base, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      path.join(base, 'chrome-headless-shell-linux64/chrome-headless-shell'),
      path.join(base, 'chrome-headless-shell-win64/chrome-headless-shell.exe'),
    );
  }
  return out;
}

function systemBrowser() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function findChromium() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  for (const cache of browserCacheRoots()) {
    const hit = browserCandidates(cache).find((file) => fs.existsSync(file));
    if (hit) return hit;
  }
  return systemBrowser();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(appDir, url === '/' ? 'index.html' : url);
    const relative = path.relative(appDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(appDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const PAGE_TEXT = ['---', 'title: 端到端测试页', 'tags: [攻略]', '---', '', '## 主链路', '', '原始正文。', ''].join(
  '\n',
);
const PAGE_B64 = Buffer.from(PAGE_TEXT, 'utf8').toString('base64');

const sha = (char) => char.repeat(40);

async function mockGitHub(page) {
  // Keep the run hermetic: no remote editor-config.json fetch.
  await page.route('**/raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api.github.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, accept, x-github-api-version, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': 'x-oauth-scopes',
      'x-oauth-scopes': 'public_repo',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

    if (pathname === '/user') return json({ login: 'e2e-tester', name: 'E2E' });
    if (pathname.endsWith('/releases/latest')) return json({ tag_name: 'v0.0.1', name: 'old' });
    if (/\/repos\/[^/]+\/[^/]+$/.test(pathname) && method === 'GET') {
      return json({ default_branch: 'main', permissions: { push: true } });
    }
    if (pathname.includes('/git/ref/heads/')) return json({ object: { sha: sha('a') } });
    if (pathname.includes('/git/commits/')) return json({ tree: { sha: sha('b') } });
    if (pathname.includes('/contents/')) {
      return json({
        content: PAGE_B64,
        sha: sha('c'),
        size: PAGE_TEXT.length,
        encoding: 'base64',
        path: PAGE_PATH,
      });
    }
    if (pathname.includes('/git/trees/') && method === 'GET') {
      return json({
        tree: [
          { path: PAGE_PATH, type: 'blob', sha: sha('c') },
          { path: 'games/Example/assets/icons/iron-plate.svg', type: 'blob', sha: sha('d') },
        ],
      });
    }
    if (pathname.endsWith('/git/refs') && method === 'POST') return json({ ref: 'refs/heads/x' });
    if (pathname.endsWith('/git/blobs')) return json({ sha: sha('d') });
    if (pathname.endsWith('/git/trees') && method === 'POST') return json({ sha: sha('e') });
    if (pathname.endsWith('/git/commits') && method === 'POST') return json({ sha: sha('f') });
    if (pathname.includes('/git/refs/heads/') && method === 'PATCH') return json({});
    if (pathname.endsWith('/pulls') && method === 'POST') {
      return json({ html_url: `https://github.com/${OWNER}/${REPO}/pull/42`, number: 42 });
    }
    // Review panel: conflicting PR + one approval.
    if (/\/pulls\/42$/.test(pathname) && method === 'GET') {
      return json({
        state: 'open',
        merged: false,
        draft: false,
        mergeable: false,
        mergeable_state: 'dirty',
        comments: 2,
        review_comments: 1,
        commits: 1,
        changed_files: 1,
        additions: 3,
        deletions: 1,
        head: { ref: 'wfe/e2e', repo: { owner: { login: OWNER } } },
        base: { ref: 'main' },
      });
    }
    if (/\/pulls\/42\/reviews$/.test(pathname) && method === 'GET') {
      return json([{ state: 'APPROVED', user: { login: 'maintainer' } }]);
    }
    if (pathname.endsWith('/pulls')) return json([]);
    return json({ message: `unmocked ${method} ${pathname}` }, 404);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

const chromiumPath = findChromium();
if (!chromiumPath) {
  if (process.env.REQUIRE_E2E === '1') {
    console.error('[e2e] 未找到 Chromium，且 REQUIRE_E2E=1：请安装 Playwright 浏览器或设置 PW_CHROME。');
    process.exit(1);
  }
  console.log('[e2e] 未找到本地 Chromium，跳过（设置 PW_CHROME 或安装 Playwright 浏览器）。');
  process.exit(0);
}

const { server, port } = await startServer();
const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await mockGitHub(page);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForSelector('.cm-editor');

  // 1. Token (memory only) through the settings dialog.
  await page.evaluate(() => document.querySelector('#btn-settings')?.click());
  await page.waitForSelector('#set-token');
  await page.fill('#set-token', 'ghp_e2e_token');
  await page.click('.modal-foot .btn-primary');
  await page.waitForTimeout(300);

  // 2. 加载
  await page.fill('#content-path', PAGE_PATH);
  await page.click('#btn-content-load');
  await page.waitForFunction(() => window.__WFE__?.state?.content?.body?.includes('原始正文'));
  assert((await page.evaluate(() => window.__WFE__.state.content.path)) === PAGE_PATH, '页面路径已加载');

  // 3. 编辑（通过 CodeMirror 公开接口）
  await page.evaluate(() => {
    const editor = window.__WFE__.editors.body;
    editor.insert('\n\n新增一行：E2E 测试。');
  });
  await page.waitForTimeout(150);

  // 4. 检查
  await page.evaluate(() => window.__WFE__.validateNow({ open: true }));
  await page.waitForTimeout(500);
  const issues = await page.evaluate(() => window.__WFE__.issues.map((item) => item.message));
  assert(Array.isArray(issues), '检查返回问题列表');
  if (await page.$('.modal-title')) {
    const dialogTitle = await page.textContent('.modal-title');
    assert(/检查/.test(dialogTitle || ''), `检查弹窗出现（${dialogTitle}）`);
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.modal-foot .btn')];
      buttons.find((button) => button.textContent === '关闭')?.click();
    });
    await page.waitForTimeout(200);
  }

  // 5. 预览
  await page.click('#btn-preview');
  await page.waitForSelector('#preview-overlay:not([hidden])');
  assert((await page.textContent('#preview-article')).includes('E2E 测试'), '预览包含新增内容');
  await page.click('#btn-preview-close');

  // 6. PR（mock）
  await page.click('#btn-pr');
  await page.waitForSelector('.modal-title');
  let title = await page.textContent('.modal-title');
  if (/token 权限/.test(title || '')) {
    await page.click('#pr-ack-continue');
    await page.waitForTimeout(1500);
    title = await page.textContent('.modal-title');
  }
  assert(/提交 Pull Request/.test(title || ''), `PR 弹窗出现（${title}）`);
  await page.fill('#pr-note', 'E2E 自动测试提交');
  await page.click('.modal-foot .btn-primary');
  await page.waitForFunction(() => document.body.textContent.includes('Pull Request #42 已创建'), null, {
    timeout: 15000,
  });

  // 7. 审阅状态（mock /pulls/42：存在冲突）
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.modal-foot .btn')];
    buttons.find((button) => button.textContent.includes('审阅'))?.click();
  });
  await page.waitForSelector('#review-card .pr-summary');
  const reviewText = await page.textContent('#review-card');
  assert(/已批准/.test(reviewText || ''), '审阅状态包含批准数');
  assert(/冲突/.test(reviewText || ''), `冲突时给出指引（${reviewText?.slice(0, 80)}）`);
  assert(/git merge/.test(reviewText || ''), '冲突指引包含 git 命令');
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.modal-foot .btn')];
    buttons.find((button) => button.textContent === '取消')?.click();
  });
  await page.waitForTimeout(200);

  // 8. 批量操作：列表、重命名输入框
  await page.evaluate(() => document.querySelector('#btn-batch').click());
  await page.waitForSelector('#batch-list .batch-row');
  const rows = await page.$$eval('#batch-list .batch-row', (nodes) => nodes.length);
  assert(rows >= 1, `批量列表渲染页面（${rows}）`);
  await page.click('[data-batch-mode="rename"]');
  assert(await page.$eval('.batch-name', (el) => !el.hidden), '批量重命名的文件名输入框可见');
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.modal-foot .btn')];
    buttons.find((button) => button.textContent === '取消')?.click();
  });
  await page.waitForTimeout(200);

  assert(errors.length === 0, `无页面异常（${errors.join('; ')}）`);
  console.log('[e2e] 主链路通过：加载 → 编辑 → 检查 → 预览 → PR → 审阅状态 → 批量操作');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
