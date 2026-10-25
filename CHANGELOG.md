# Changelog

本文件保存 Wikifactory Editor 的历史更新记录。

## v1.3.2 质量更新

- **格式栏点击提示**：点击格式栏（工具栏）任意按钮后，会短暂显示该按钮的说明，触屏设备无需依赖 hover；桌面端同样生效，弹窗打开时自动收起。
- **必需状态检查可见**：PR 审阅面板新增「自动检查」一行（全部通过 / N 项进行中 / N 项未通过），未通过时列出失败的检查名（可点开 Actions 日志）并给出修复步骤：本地 `npm run content:validate` 自查、修复后在同一分支追加提交、与内容无关的失败联系维护者重跑。仓库开启 Require status checks 后，检查未通过会阻止合并，面板会把状态标为「暂时不可合并」。
- **同一分支追加提交**：PR 窗口新增「更新已有分支」选项（存在本次会话的 PR 时默认勾选，并预填该 PR 分支）。编辑器会校验分支最新提交属于当前账号，然后在该分支上追加提交，避免为修复检查而新建重复 PR。
- **文档**：README 仅保留仓库介绍，版本历史全部移入本文件；CHANGELOG 不再声明「README 保留最近三条更新」。
- 版本号：**1.3.2**（Android versionCode 10302）。

## v1.3.1 功能更新

- **顶部两枚网络状态灯**：A 灯读取系统网络状态（Android 走原生 `ConnectivityManager.isNetworkAvailable()`，其他平台用 `navigator.onLine`，另加 online/offline 事件与 15 秒轮询）；B 灯实际探测 `api.github.com/rate_limit`，收到 < 500 的响应即视为可达。B 灯替换「Content」前的静态圆点，点击可重新检测；GitHub 请求网络失败或 5xx 时自动重测，而不是直接判红。
- **移除「仅 Content 编辑」提示**：侧栏、设置与帮助中不再出现 Core / Alias 相关说明；仓库访问限制仍保留在网络层作为内部保护。
- **Android**：新增 `isNetworkAvailable()` 桥接方法与 `ACCESS_NETWORK_STATE` 权限。
- 版本号：**1.3.1**（Android versionCode 10301）。

## v1.3.0 质量更新

- **重命名按 Core 规则解析短链接**：`rewritePageLinks()` 不再只比较文件名。先按 Core `resolveWikiTarget` 的优先级（完整 id → 游戏 → 分类 → 当前游戏内唯一 slug → 全局唯一 → 别名）确定目标，再决定是否改写；歧义短链接保留原样并在日志、PR 说明中列出候选页面。
- **扫描范围与覆盖率分级**：批量重命名新增「同游戏目录 / 全部页面」选项；扫描结束明确报告「完整 / 部分完成」及原因（跨游戏未检查、超出上限、读取失败、无法确定目标的短链接），并写入 PR 说明。
- **草稿双存储**：localStorage 保留最近 30 份，IndexedDB 归档全部草稿；超出上限时提示被归档的路径，归档草稿可恢复、可导出/导入 JSON 备份；localStorage 损坏时启动自动重建。
- **Token 密钥稳定化**：密钥派生只用安装标识 + 固定盐，不再混入语言、屏幕、时区、UA；旧记录兼容读取并自动升级；无法解密时保留记录并提示重新授权，不再静默删除。
- **PR 提交断点续传**：新增提交日志（分支 + 阶段）。网络中断后可用「继续未完成提交」复用分支、跳过已完成提交、避免重复 PR。
- 版本号：**1.3.0**（Android versionCode 10300）。

## v1.2.7 安全更新

- **owner / repo 单一来源**：新增 [`scripts/repo.mjs`](scripts/repo.mjs)，构建脚本与运行时所需的 owner、仓库名、Issue 链接全部来自 `editor-config.json`。原先散落在 `version.mjs`、`build-desktop.mjs`、`sign-windows.mjs`、`editor-config.mjs` 里的 `hellokug2699` 字面量已移除；运行时代码中不再出现 owner。新增可选字段 `allowedOwners`（提前授权新组织）与 `editor.issueUrl`（校验必须指向 editor 仓库）。
- **迁移不再牵一发动全身**：迁移只改 `editor-config.json` → `npm run config:sync` → `npm run version:sync`。
- **迁移审计**：新增 `npm run repo:audit`（`--strict` 可在仍有硬编码 owner 时失败）。
- **恢复历史 APK**：v1.1.0 – v1.1.8 的 Release 已补回 debug 签名测试包（debug keystore 与正式签名不同，不能覆盖升级）；v1.1.9 起仍由 CI 构建签名 APK。
- **签名证书轮换**：Windows Authenticode 自签名证书更新为 `F4:EC:FB:EA:…:4C:4C:49`（10 年期）；CI secrets `WINDOWS_SIGNING_P12_BASE64` / `WINDOWS_SIGNING_PASSWORD`。
- **测试**：新增 `tests/repo.test.mjs`；e2e 的 GitHub mock 改为读取 `editor-config.json`。

### 迁移清单（owner / repo 变更时）

| 位置 | 需要做什么 |
| --- | --- |
| `editor-config.json` | 改 `content.owner` / `content.repo` / `editor.owner` / `editor.repo` / `editor.issueUrl`，可选 `allowedOwners` |
| 生成文件 | `npm run config:sync`、`npm run config:sign`、`npm run version:sync` |
| 配置签名私钥 | `config-signing-key.pem` 放在私有 Core 仓库的 `signing/`；丢失后重新 `config:keygen` 并重签 |
| Android 签名 | CI secrets `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` |
| Windows 签名 | CI secrets `WINDOWS_SIGNING_P12_BASE64` / `WINDOWS_SIGNING_PASSWORD` |
| Core `public/.well-known/assetlinks.json` | 包名不变则无需改；换 keystore 才需要更新指纹 |

## v1.2.5 质量更新

- **移动端差异化**：Android 新增 Intent filter —— `https://wikifactory.top/games/…`、`wikifactory-editor://open?path=…` 与 `text/markdown` 文件「用其他应用打开」。站点侧部署 `/.well-known/assetlinks.json`（由私有 Core 仓库的 `public/.well-known/assetlinks.json` 提供）并通过 App Links 校验后，`wikifactory.top/games/…` 会直接唤起 App；若校验未通过，系统会退回「用其他应用打开」的询问框（不会静默失败）。应用内点击站内链接也走同一套深链解析。网页版可用 `?path=games/…` 直达。
- **审阅闭环**：PR 创建后按钮变为 `PR #编号`，可随时打开「PR 审阅状态」查看 state / 审阅结论 / 批准·要求修改·评论·待审阅数量 / 评论与审阅评论数 / 变更行数，并每 30 秒刷新。存在冲突时不再建议「换个分支名」，而是给出 `git merge`、`git rebase`、`--force-with-lease` 的完整步骤与 GitHub 网页端替代方案。
- **批量操作**：侧栏新增「批量操作」。**批量编辑**把多个页面放进编辑队列，逐页修改后汇总成一个 PR（切换页面时自动保留队列内容）；**批量重命名**一次改多个页面，并扫描同游戏目录自动改写指向这些页面的 `[[…]]` 站内链接（代码块与行内代码不动），最终一个 PR 内完成改名 + 链接更新 + 旧文件删除。
- **i18n 与无障碍**：新增 `i18n.js`（zh / en），界面控件、工具栏、设置与 v1.2.5 新窗口全部双语，缺失条目回退中文。CSP 收窄：`img-src` / `media-src` 只允许 `raw.githubusercontent.com` 与本机，`frame-src` 仍只放开 YouTube / 哔哩哔哩 / Vimeo；`frame-ancestors 'none'` 与 `X-Frame-Options: DENY` 通过 `app/_headers` 下发（浏览器忽略 meta 里的 frame-ancestors）。提交 / 批量改名等 busy 期间 Esc 与点击遮罩不再关闭窗口；toast 区域补 `role="status"` 与 `aria-live`。
- **配置化**：新增仓库根 `editor-config.json`（Content owner/repo/branch、Release 仓库、保留路径与上传上限），构建时由 `scripts/editor-config.mjs` 生成带 SHA-256 与 owner 白名单的 `editor-config.js`。运行时先校验哈希：仓库地址与内置值一致时直接应用；若指向其他仓库且哈希不符，**不会自动切换**，而是在侧栏「编辑范围」中等待确认（批准结果按配置哈希记住）。`rules.maxUploadMb` 会真正限制上传大小；`rules.reservedPaths` 必须与共享规则 `content-rules.js` 一致（它是断言，不是第三份副本）。**迁移 Content 仓库只需改这个 JSON 并在客户端确认，不必发新版**。
- 版本号：**1.2.5**（Android versionCode 10205）。

## v1.2.4 质量更新

- **拆分 main.js**：抽出 `dom.js`（`h()` 模板函数，默认转义）、`pr.js`（PR 模板 / 分支名 / diff 数据）、`repo-cache.js`（离线文件树缓存）、`issues.js`（问题分组与行内诊断映射）、`toolbar.js`、`frontmatter-form.js`；`main.js` 只保留 UI 编排，新增逻辑可以直接写单测。
- **YAML 真解析器**：frontmatter 改用 `yaml` 包（esbuild 打包为 `vendor/yaml.bundle.js`），保留注释、块标量与未知字段；`tags` 仍以 `[攻略, 建筑]` 形式写回。
- **表单显式应用**：编辑表单不再 300 ms 自动覆盖 YAML，而是显示「待应用：标题 / 分类…」工具条；点「应用更改」后先展示 frontmatter diff 再写入，也可一键放弃。保存草稿 / 预览 / 提交 PR 时会自动应用，避免遗漏。
- **版本单一来源**：新增 `scripts/version.mjs`（`npm run version:check / version:sync`），统一生成 `app/assets/js/version.js`，并校验 `package.json`、`package-lock.json`、`desktop/neutralino.config.json`、`build.gradle`、`updates/desktop.json` 与 README；Android `versionCode` 由版本号推导（major×10000 + minor×100 + patch），CI 构建时通过 Gradle 属性注入。因此 `versionCode` 从 v1.2.3 手写的 `15` 变成 v1.2.4 的 `10204`：这是一次性的编号规则切换，不是多发了版本；`10204 > 15`，已安装用户仍可覆盖升级，之后 1.2.5 = 10205、1.3.0 = 10300 单调递增。限制是次版本与补丁号需 < 100（`1.2.100` 会与 `1.3.0` 同为 10300）。
- **分发重做**：交付产物移出 git（`dist/` 已加入 `.gitignore`，只发布到 Releases + Actions artifact）。
- **自动更新**：设置新增「更新方式」0 自动下载 / 1 提示 / 2 不检查，更新窗口支持「不再显示此窗口」。桌面端通过 Neutralino `updater` 下载 `resources.neu`，重启生效；Android 打开签名 APK 下载地址（需允许安装未知来源）；网页版刷新 Service Worker 缓存。
- **Web PWA**：新增 `manifest.webmanifest` 与 `sw.js`，支持安装到桌面 / 主屏与离线打开；不再依赖 `serve.mjs`，用任意静态服务器托管即可（需 https 或 localhost）。
- **测试升级**：`happy-dom` + `node:test` 覆盖 `h()`、frontmatter 表单、工具栏、PR 模板、仓库缓存与问题映射；`setYamlField` 增加 60 组 property-based roundtrip（保证未知字段 / 注释 / 块标量不丢）；Playwright 主链路（加载 → 编辑 → 检查 → 预览 → PR mock）见 `npm run test:e2e`。
- 版本号：**1.2.4**（Android versionCode 10204）。

> 更早的版本记录（v1.1.1 – v1.2.3）已移至 [CHANGELOG.md](CHANGELOG.md)，避免 README 过长。

## v1.2.3 功能修复

- **修复桌面端 exe 无法启动**：Windows 分发改为 **便携 ZIP（`Wikifactory-Editor.exe` + `resources.neu`）**，不再把资源附加到 PE 尾部。旧方案把约 1.2 MB 资源嵌入 exe，容易被杀毒软件当作自解压壳拦截，也让部分机器无法加载资源。`resources.neu` 采用 Neutralinojs 官方默认的资源加载方式，已在同源构建上验证可正常启动并返回页面。
- **启动失败可诊断**：桌面端配置启用 `logging`，启动异常会在 exe 同目录留下 `neutralinojs.log`；ZIP 内的 `README.txt` 列出 WebView2 Runtime、Windows「解除锁定」与杀毒软件白名单等排查步骤。
- **exe 自签名**：新增 `scripts/sign-windows.mjs`（`npm run sign:windows`），用自签名证书对 exe 做 Authenticode 签名；构建时设置 `WINDOWS_SIGNING_P12` 即自动签名并打印证书指纹。SmartScreen 仍会拦截（自签名不受信任），但「文件属性 → 数字签名」可以分辨 exe 是否被篡改。公开证书见 [desktop/codesign/wikifactory-editor-codesign.crt](desktop/codesign/wikifactory-editor-codesign.crt)，SHA-256 指纹 `56:94:8A:28:78:1E:1C:3A:9E:1F:9E:B3:D1:7D:3F:50:C0:67:75:33:00:10:D6:33:11:AF:AF:DF:CE:80:5A:51`。
- **移除未签名 APK**：`dist/` 与所有 GitHub Release 中的 debug 签名 APK 已删除，只保留 CI 用 release keystore 签名的 `-android-release.apk`。`build:android` 仍可在本地生成 debug 包，但会被 `.gitignore` 排除。
- 版本号：**1.2.3**（Android versionCode 15）。

## v1.2.6 质量更新

- **跨平台行尾**：新增 `.gitattributes`（`* text=auto eol=lf`）与 `.editorconfig`；`version.mjs` / `editor-config.mjs` 的生成文件校验按 LF 归一化。修复 Windows 检出后 `npm test` 与 `npm run lint` 必然失败的问题；CI 增加 Windows 矩阵。
- **PWA 可靠性**：`sw.js` 预缓存全部运行时资源（此前没有预缓存任何 JS），缓存桶按构建版本注入，应用代码改网络优先，安装后首次离线即可用；检测到新版本时提示刷新。
- **Android App Links**：Manifest 增加 `autoVerify`，Core 仓库新增 `public/.well-known/assetlinks.json`（固定 release 证书指纹）；校验失败时退回系统选择器。
- **配置安全**：远程配置的哈希校验改为 fail-closed；在「指向其他仓库 + 哈希不符」时不再静默应用，而是等待侧栏确认（按配置哈希记忆）。`rules.maxUploadMb` 接入图片 / 图标 / 音频上传上限，GIF / SVG 超限直接拒绝；`rules.reservedPaths` 与共享规则不一致时拒绝配置。
- **批量重命名**：补上路径层级、非法字符、保留目录、扩展名与 `.md`/`.mdx` 同 URL 冲突校验；正文读取改为并发 4；扫描上限从静默 60 提高到 200 并在超限时明确提示。
- **深链**：拒绝 `.` / `..` / 空段 / 反斜杠 / 控制字符，加载前再次校验仓库路径；预览中的 `[[页面]]` 可在应用内跳转。
- **UI 转义**：`openModal` 的 subtitle 与 `confirmDialog` 的 message 默认转义（批量重命名显式走 `messageHtml` 并转义路径）。
- **测试与发布**：e2e 支持 Windows / macOS / Linux 的 Chromium 查找，缺失浏览器时 CI 直接失败；`node --test` 自行发现测试文件（Windows runner 不展开 `tests/*.test.mjs`，此前矩阵必失败）；新增 `.github/workflows/release.yml` 构建并附加 Windows ZIP、`resources.neu`、web ZIP 与 SHA-256，配置 `WINDOWS_SIGNING_P12_BASE64` 后自动签名。
- **文档**：修正更新渠道、网络白名单、构建示例版本与 App Links 说明；补充 Content / Core 的行尾约定。

## v1.2.2 质量更新

- **编辑器基础补齐**：接入 CodeMirror 6 的搜索（`Ctrl/Cmd+F`、`Ctrl/Cmd+H` 查找替换、匹配高亮）、自动补全（`[[` 补全站内页面，`[icon=` 补全当前游戏图标名，frontmatter 的 `tags` 补全内置分类）、自动闭合括号与选中内容高亮。补全数据直接复用仓库文件树、`PAGE_TAG_VALUES` 与图标索引，不额外发请求。
- **新增快捷键**：`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+K` 插入 Markdown 链接、`Ctrl/Cmd+Shift+K` 插入站内链接并自动弹出补全。
- **修复数据丢失 + 多草稿**：加载 / 浏览切换 / 新建页面前会检查未保存修改，可选择「保存草稿并继续 / 放弃修改 / 取消」。草稿改为按仓库路径分别保存在本机（最多 30 份），侧栏新增「最近草稿」入口，可恢复或删除任意一份，切换页面不再互相覆盖。
- **粘贴 / 拖拽图片**：直接在正文粘贴或拖入图片，图片会加入「待上传资源」并插入 `[[File/名称|md]]`；超过 1 MB 的位图会用 canvas 缩放到长边 1600px 以内并转为 WebP，避免把几 MB 的 PNG 提进仓库。
- **行内诊断**：校验结果通过 `@codemirror/lint` 映射为波浪线与行号栏标记，悬停可看具体文案；错误 / 警告与「检查」弹窗保持一致，点击问题跳行仍然可用。
- **工程化底线**：新增 ESLint（flat config）+ Prettier 与 `npm run lint`；新增 `.github/workflows/ci.yml`（push / PR 运行 `npm ci && npm run lint && npm test`）。移除遗留的 `editor.js`、`repoSlug` 与未使用的工具函数，并清理不再引用的 CSS 变量。
- 版本号：**1.2.2**（Android versionCode 14）。

## v1.2.1 质量更新

- **音频 / 嵌入的来源说明与降级提示**：预览中的嵌入块会显示「来源：YouTube · youtube/ID」以及「若无法播放，请点此打开原链接」；音频加载失败时会明确说明可能的原因（文件不存在 / 浏览器不支持 OGG），并提供「打开原文件」入口，而不是只显示一个空白的播放器。
- **嵌入链接「粘贴即预览」**：粘贴完整链接后，对话框先显示识别结果（来源、视频 ID、可获取的标题）与原链接，编辑者确认后再转换为短标记 `[[Embed/youtube/ID|标题]]`，避免粘错链接后手动改标记。YouTube / Vimeo 标题通过官方 oEmbed 读取，失败时可手动填写。
- **离线 / 弱网体验**：Content 仓库文件树会缓存在本机（7 天，按分支区分）。网络不可用或请求超时时，图标 / 音频 / 站内链接校验会回退到缓存，并在相关窗口标注「基于本地缓存，可能过期」；PR 窗口新增「保存草稿」，可先保留修改，等网络恢复后再提交。GitHub API 请求新增 20 秒超时，避免弱网下无限等待。
- **PR 模板与提交信息规范**：PR 窗口新增「变更类型（新增页面 / 修改内容 / 修复引用）」与必填「说明」，提交信息、PR 标题与 PR 说明按模板自动生成，仍可手动调整。模板完全由编辑器侧生成，不依赖仓库配置。
- **站内链接目标校验**：复用文件树把 `[[页面|显示文字]]` 的目标解析到真实页面 / 游戏 / 分类 / 文件名；缺失时给出警告（不阻断提交，目标可能是有意提前占位或使用别名）。
- **内容差异预览**：PR 窗口展示「加载时的原始内容 vs 当前编辑内容」的行级差异（+ / − 行数、上下文折叠、路径变更提示），帮助贡献者在提交前自查。
- **README 更新日志精简**：历史版本移至 [CHANGELOG.md](CHANGELOG.md)，README 只保留最近几个版本，降低新用户的信息负担。
- 版本号：**1.2.1**（Android versionCode 13）。

## v1.2.0 功能更新

- **音频插入（仅 OGG）**：工具栏新增「音频」。语法为 `[[Audio/名称.ogg|标题]]`，文件放在 `games/<游戏>/assets/audio/`，标题可省略。对话框只接受 `.ogg`，可随 PR 上传；编辑器预检、Content/Core 门禁都会校验扩展名与文件是否存在。预览先显示占位块，点击后才加载播放器。
- **嵌入播放器**：工具栏新增「嵌入」。编辑器接受编辑者粘贴的完整链接并转换为短标记 `[[Embed/youtube/ID|标题]]`，目前支持 YouTube / 哔哩哔哩 / Vimeo。编辑器 CSP 与 Core 渲染都只允许这三个来源，其他链接会被门禁拒绝。
- **折叠合并选项**：工具栏的「文本」与「块」合并为「格式」；frontmatter 的排序 / 日期 / 草稿 / 目录收进「更多选项」；设置页的「外观与编辑」「启动与退出」以及 token 步骤默认折叠，减少不必要的滚动。
- **共享规则 1.2.0**：`content-rules.js` 新增音频 / 嵌入解析与校验；Core 渲染层复用同一份逐字节副本（`src/lib/content-rules.js`）。
- 版本号：**1.2.0**（Android versionCode 12）。

## v1.1.9 功能更新

- **页面分类（tags）统一模板**：frontmatter 的 `tags` 改为由编辑器内置模板统一分发，首版包含攻略 / 建筑 / 物品 / 制造 / 研究 / 资源 / 机制 / 探索 / 剧情 / 更新。编辑器把原来的文本框换成分类 chip，只能选择模板内的值；未知分类会显示为可移除的警告 chip，并在本地预检与 Content/Core 门禁中被拒绝。
- **新增分类走 issue**：表单内提供「在编辑器仓库提交 issue」入口，附带 [新增页面分类模板](.github/ISSUE_TEMPLATE/new-page-tag.yml)。维护者更新模板后，通过 `npm run rules:sync` 与 `npm run tags:sync` 同步到 Content / Core。
- **Core 分类展示适配**：Content 仓库只保存页面文件与 tag 值；分类的展示名称、色调（accent / success / warning / danger / neutral）与说明放在 Core 的 `config/page-tags.json`（由编辑器模板生成，含规则哈希）与 `src/config/page-tags.ts`。页面元信息按模板渲染分类 badge，未知值回退为中性样式。
- **共享规则 1.1.0**：`content-rules.js` 新增 `PAGE_TAGS` / `tagProblems()`，编辑器预检与 Content、Core 门禁使用同一份分类校验；规则哈希继续由两侧 CI 校验。
- **Release 标题约定**：Release 页面标题统一为 `Wikifactory Editor vX.Y.Z`。
- 版本号：**1.1.9**（Android versionCode 11）。

## v1.1.8 质量更新

- **Release 签名与一键重签名**：新增 `scripts/android-release.mjs`（`npm run build:android:release`）。配置 `ANDROID_KEYSTORE` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` 后，脚本会执行 `gradle assembleRelease`、用你的 keystore 签名并输出 `dist/Wikifactory-Editor-v1.1.8-android-release.apk`，同时打印证书 SHA-256 与产物 SHA-256。已有 APK 可以一步重签名：`node scripts/android-release.mjs --apk dist/Wikifactory-Editor-v1.1.8-android.apk`。仓库不保存任何签名私钥，Release 中的 `-android.apk` 仍是 debug 签名，仅用于试用；长期分发请自行构建。
- **共享内容规则模块**：路径 / frontmatter / 图标 / 日期等门禁规则抽取为 `app/assets/js/content-rules.js`（零依赖纯函数，`RULES_VERSION` 1.0.0），编辑器的预检（`validate.js`）与 Content、Core 两个仓库的门禁脚本使用同一份规则。Content 与 Core 各自 vendored 一份 `scripts/content-rules.mjs` + `content-rules.sha256`，CI 在跑门禁前先校验哈希。同步命令：`npm run rules:sync -- ../Wikifactory-Content`，检查：`npm run rules:check -- ../Wikifactory-Content`。任何一侧手改都会因哈希不一致而失败，避免三处规则漂移。
- 版本号：**1.1.8**（Android versionCode 10）。

## v1.1.7 质量更新

- **新建游戏 / 文件夹**：侧栏「页面位置」新增「新建游戏」按钮。填写游戏目录、分类、首个页面（可选标题）后会生成 `games/<游戏>/<分类>/<页面>.md`；文件夹会随该页面在 PR 中自动创建（Git 不保存空目录）。保留路径（`search` / `pagefind` / `_astro` / `404` / `about`）与非法名称会被拒绝。
- **修复退出行为切换不生效**：设置中的「退出行为」现在**选择后立即持久化**，无需再点「保存设置」；此前若选好默认值又直接关闭设置窗口，退出时仍沿用旧行为。提示窗口也会显示当前默认选项。
- **启动时询问是否恢复**：不再静默打开上次页面。检测到草稿时弹出「恢复上次编辑的页面？」，显示路径 / 标题 / 草稿时间 / 字数，可选择「恢复草稿」或「新建空白页」（清空草稿并回到默认路径）。启动检查更新会等该窗口关闭后再执行，不会抢占弹窗。
- 版本号：**1.1.7**（Android versionCode 9）。

## v1.1.6 质量更新

- **token 默认不保存**：「记住 token」默认关闭，token 只留在内存；需要自动恢复时由用户显式勾选（仍为加密存储）。
- **token 权限预检**：设置中的「测试连接」会读取经典 token 的 `x-oauth-scopes`，并结合仓库 `permissions.push` 与 Fork 状态，明确显示「写权限 / 只读 / 无法确认」。只读时直接提示无法提交 PR 及需要补充的权限。
- **首次提交前确认**：第一次提交 PR 前弹出权限确认窗口（账号、权限头、上游写权限、Fork 状态、所需权限），确认后不再重复；只读 token 会被拦下。
- **预览图片按需加载**：仓库已有图片不再只是占位块——占位块显示文件名与 alt，点击后才从 `raw.githubusercontent.com` 请求该图片；加载失败会明确提示，便于校对引用。
- **分支名冲突一键建议**：冲突窗口预填「内容页-日期-短哈希」建议名，并提供「换一个建议」；可直接采纳后重试。
- **行号栏可配置**：新增「行号栏：自动（移动端隐藏）/ 始终显示 / 始终隐藏」，底部状态栏始终显示「行 当前/总行数，列」。
- 版本号：**1.1.6**（Android versionCode 8）。

## v1.1.5 质量更新

- **隐藏 Android 状态栏**：设置页新增「隐藏 Android 系统状态栏（沉浸显示）」，仅 Android 应用可见；使用 `WindowInsetsController`（API 30+）或全屏标志（API 26–29）隐藏状态栏，滑动顶部可临时呼出。设置会持久化并在每次启动时恢复。
- **修复移动端「退出应用」无效**：Android WebView 也加载了 Neutralino 兼容脚本，`Neutralino.app.exit` 抢先执行但并无原生进程可退。现在优先调用 Android 桥接 `exitApp`（`finishAndRemoveTask` + `finishAffinity`），桌面端仍走 Neutralino，纯浏览器环境会明确提示「无法自动关闭窗口」，不再静默无反应。
- 版本号：**1.1.5**（Android versionCode 7）。

## v1.1.4 功能修复

- **资源目录按类型区分**：正文大图上传到 `games/<游戏>/assets/images/`，`[icon=…]` 内联图标上传到 `games/<游戏>/assets/icons/`。图标对话框新增文件上传与路径校验，不再出现"图标建议放 images"的误导。
- **图标存在性校验**：插入图标时先读取 Content 仓库文件树，确认 `assets/icons/<名称>.<ext>` 是否存在；缺失会阻断插入并提示应先上传。待上传的图标计入本次 PR，不会误报。
- **本地对齐内容门禁**：新增与 `scripts/validate-content.mjs` 同构的检查——路径层级、frontmatter 类型（含 `null`、ISO 日期、字符串数组元素）、`[icon=]` 文件存在性、重复 URL（`.md` / `.mdx`）与大小写冲突；提交 PR 前会强制刷新仓库文件树重新校验，问题在本地暴露而不是等 CI。
- 校验失败时仍会展示具体文件与行号（如 `games/<游戏>/assets/icons/xxx.svg`），可直接跳到对应行修改。
- 版本号：**1.1.4**（Android versionCode 6）。

## v1.1.3 功能更新

- **启动检查更新**：每次启动通过 GitHub API 读取编辑器仓库的最新 Release，仅提示版本与说明，**不自动下载**；设置页可关闭，也可以在提示窗口中勾选「不再在启动时检查更新」。
- **CONTRIBUTING.md 联动**：帮助、设置与移动端菜单新增「Content 使用须知」，直接读取 `Wikifactory-Content/CONTRIBUTING.md` 并在应用内渲染（相对链接自动转为 GitHub 地址）；读取失败时给出 GitHub 直达链接。
- **退出提示**：退出时若本次会话有修改，提示「保存并退出 / 不保存退出 / 取消」；保存后下次启动恢复，不保存则回到进入程序时的内容。可在设置 →「退出行为」选择「每次询问 / 总是保存 / 不保存直接退出」，提示窗口内也会说明该入口。
- Android 返回键同样会走退出确认；桌面版与网页版在直接关闭窗口时由 `beforeunload` 按同一设置处理。
- 版本号：**1.1.3**（Android versionCode 5）。
- 注意：本次 APK 由新的 Android debug 密钥签名，指纹与 1.1.2 不同；若覆盖安装失败，请先卸载旧版再安装。

## v1.1.2 功能修复

- **允许粘贴**：token 输入框仍禁止复制 / 剪切 / 拖拽，但支持 `Ctrl/⌘+V`、右键菜单与移动端长按粘贴（1.1.1 一并屏蔽了右键菜单，导致部分设备无法粘贴）。
- **记住 token**：新增「记住 token」选项（1.1.6 起默认关闭），token 加密保存在本机，下次启动自动恢复并验证，无需每次重新填写。
- **加密存储，而非明文**：token 必须先恢复才能使用，单向哈希无法满足自动登录，因此采用可逆加密：
  - Android：AES-GCM 密钥生成在 **Android Keystore** 内，密钥不可导出；磁盘上只有密文。
  - 网页 / Windows：WebCrypto **AES-256-GCM**，密钥由安装标识与设备特征经 PBKDF2（21 万次）派生，localStorage 中只有密文与随机 IV。
  - 关闭「记住 token」后仍为仅内存模式；旧版本的明文 token 会在启动时被清除。
- 版本号：**1.1.2**（Android versionCode 4）。

## v1.1.1 安全更新

- **token 不落盘**：只保存在当前运行内存，不写入 localStorage / 文件；关闭应用即失效。旧版本遗留的本地 token 会在启动时被清除。
- **禁止显示与复制**：token 输入框保持 password，移除「显示」按钮，并阻止复制、剪切、右键菜单与拖拽。
- **完整 token 指南**：设置页新增从创建 token 到测试连接的完整步骤，并明确说明公开仓库不等于可推送，绝大多数贡献者必须通过 Fork 提交。
- **分支名冲突处理**：编辑器不再自动追加后缀；若分支名被其他人占用，会弹出错误窗口要求更换，并保留已填写的提交信息。
- **自动删除已合并分支**：新增 GitHub Actions workflow，合并后删除本仓库中的 head 分支；Fork 分支需贡献者在自己的 Fork 中删除。
- 版本号：**1.1.1**（Android versionCode 3）。
