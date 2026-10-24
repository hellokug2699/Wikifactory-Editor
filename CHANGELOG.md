# Changelog

本文件保存 Wikifactory Editor 的历史更新记录。README 只保留最新 3 个版本的摘要。

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
