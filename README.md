# Wikifactory Editor

面向 [Wikifactory](https://wikifactory.top) 内容仓库贡献者的跨平台编辑器。它在编辑器中提供真正的语法高亮、Wiki 语法工具、frontmatter 表单、表格/图片生成器与按需预览，并通过**纯客户端** GitHub API 提交 PR。

![主编辑界面](docs/screenshots/desktop-main-light.png)

> **版本更新记录见 [CHANGELOG.md](CHANGELOG.md)。** 下载最新版本请到 [Releases](https://github.com/hellokug2699/Wikifactory-Editor/releases/latest)。

## 下载

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| Windows | `Wikifactory-Editor-windows-x64.zip` | 便携 ZIP（`Wikifactory-Editor.exe` + `resources.neu`），exe 已自签名；解压后双击运行，需要 WebView2 Runtime |
| Windows 更新包 | `Wikifactory-Editor-windows-x64-resources.neu` | 供桌面端自动更新使用；手动更新请下载 ZIP |
| Android（签名） | `Wikifactory-Editor-android-release.apk` | 由 CI 用发布 keystore 签名，可覆盖升级 |
| 网页版（PWA） | `Wikifactory-Editor-web.zip` | 解压后用任意静态服务器托管（https 或 localhost）；可安装到桌面并离线打开 |

产物只发布在 [Releases](https://github.com/hellokug2699/Wikifactory-Editor/releases) 与 Actions artifact，仓库不再保存 `dist/` 二进制。

> Windows 不再发布单文件 exe。单文件版本把资源附加在 exe 末尾，容易被杀毒软件误判，也可能在部分机器上启动失败；ZIP 中的 `resources.neu` 是 Neutralinojs 的默认资源方式。
>
> Release 中不提供未签名（debug）APK，Android 只提供 CI 签名版。

### Windows 自签名

exe 使用自签名证书做 Authenticode 签名。SmartScreen 仍会提示「未知发布者」，但可以在「文件属性 → 数字签名」中确认签名者与完整性：

```powershell
# Windows：查看签名与证书指纹（需安装 Windows SDK 的 signtool）
signtool verify /pa /v Wikifactory-Editor.exe
Get-AuthenticodeSignature .\Wikifactory-Editor.exe | Format-List
```

```bash
# Linux / macOS：用仓库中的公开证书校验
osslsigncode verify -CAfile desktop/codesign/wikifactory-editor-codesign.crt -in Wikifactory-Editor.exe
```

证书 SHA-256 指纹：`F4:EC:FB:EA:9E:3F:45:57:9D:42:40:B0:58:44:73:DE:FA:29:F9:A2:A4:FA:78:F5:53:06:5F:93:A2:4C:4C:49`。
私钥不进仓库；重新签名时设置：

```bash
export WINDOWS_SIGNING_P12=/path/to/windows-signing.p12   # 或 base64 文本
export WINDOWS_SIGNING_PASSWORD='***'
export WINDOWS_SIGNING_CERT=desktop/codesign/wikifactory-editor-codesign.crt
npm run build:desktop          # 构建时自动签名
npm run sign:windows -- dist/.../Wikifactory-Editor.exe   # 也可以单独签
npm run sign:windows -- --verify dist/.../Wikifactory-Editor.exe
```

CI 的 `release.yml` 会自动安装 `osslsigncode`；配置 `WINDOWS_SIGNING_P12_BASE64` 与 `WINDOWS_SIGNING_PASSWORD` 两个 secrets 后，每次发版都由 CI 用同一张证书签名。

### 启动失败排查（Windows）

1. **解压后再运行**：直接双击 ZIP 内的 exe 不会解压，必须先把 exe 与 `resources.neu` 解压到同一目录。
2. **解除锁定**：右键 exe → 属性 → 勾选「解除锁定」→ 确定（浏览器下载的文件会带 Mark-of-the-Web）。
3. **WebView2 Runtime**：Windows 10/11 通常自带；若缺少，安装 <https://go.microsoft.com/fwlink/p/?LinkId=2124703>。
4. **查看日志**：启动失败时 exe 同目录会生成 `neutralinojs.log`，常见原因是杀毒软件拦截或 WebView2 缺失；可把该目录加入杀毒软件白名单后重试。

### Android 签名

```bash
# 1. 生成本地 keystore（不要提交到仓库）
keytool -genkeypair -v -keystore release.jks -alias wikifactory \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. 设置签名环境变量
export ANDROID_KEYSTORE=$PWD/release.jks
export ANDROID_KEYSTORE_PASSWORD='***'
export ANDROID_KEY_ALIAS=wikifactory
export ANDROID_KEY_PASSWORD='***'

# 3. 构建 release APK 并签名（输出 dist/Wikifactory-Editor-<version>-android-release.apk）
npm run build:android:release

# 也可以只重签已有 APK（不重新构建）
node scripts/android-release.mjs --apk dist/Wikifactory-Editor-<version>-android.apk
```

脚本会调用 `apksigner` 校验签名并打印签名者证书 SHA-256 和 APK SHA-256。请妥善保管 keystore：同一个 keystore 才能覆盖升级已安装的应用；丢失后只能卸载重装。

#### 在 GitHub Actions 中签名

仓库内置 [.github/workflows/android-release.yml](.github/workflows/android-release.yml)：手动触发时构建并上传签名 APK 工件；发布 GitHub Release 时会校验标签与 `package.json` 版本一致，并把签名 APK 附加到该 Release。工作流不会生成或保存密钥，缺少 secrets 时会直接失败。

在 **Settings → Secrets and variables → Actions** 添加：

| Secret | 内容 | 推荐设置 |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的单行 base64 | `base64 -w0 release.jks`（macOS 用 `base64 -i release.jks`） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 | 24 位以上随机字符串 |
| `ANDROID_KEY_ALIAS` | 密钥别名 | `wikifactory` |
| `ANDROID_KEY_PASSWORD` | 密钥密码 | 与 keystore 密码相同（PKCS12 的推荐做法） |

注意事项：

- 只保存 base64 文本，不要把 keystore 或密码提交到仓库；
- `ANDROID_KEYSTORE_BASE64` 必须是完整的单行文本（长度应为 4 的倍数）；工作流会先用 `keytool` 校验 keystore 能否打开，失败时会直接提示，而不是等到 apksigner 才报错；
- 请离线备份 keystore 与密码：丢失后已安装用户无法覆盖升级，只能卸载重装；
- 若希望敏感操作更可控，可在 Settings → Environments 新建 `release` 环境并添加 Required reviewers，再把 secrets 放在该环境下。

### 校验和

`dist/SHA256SUMS.txt` 不再入库。每次发布时，CI 会把各产物的 SHA-256 写入 Release 说明，并随 Actions artifact 保留；下载后可用 `sha256sum -c`（Linux / macOS）或 `Get-FileHash`（Windows）核对。

签名版 APK 由 CI 在发布 Release 后附加（其 SHA-256 会同步写入 Release 说明）；签名证书 SHA-256 固定为 `6e2bff4309e91943934609e5229e38f14e4798d4034e3f4d7f1f99f9a253b435`，后续版本可覆盖升级。

## 功能

### 深链与外部打开

| 入口 | 用法 |
| --- | --- |
| 网站页面 | `https://wikifactory.top/games/<游戏>/<分类>/<页面>/` 已通过 App Links 校验时直接唤起 App，否则由系统询问打开方式 |
| 自定义 scheme | `wikifactory-editor://open?path=games/…` |
| 网页版 | `index.html?path=games/…` 或 `?open=<任意受支持链接>` |
| Markdown 文件 | Android「用其他应用打开」→ Wikifactory Editor，作为新页面导入（保存前确认仓库路径） |

重命名 / 批量编辑与审阅状态都在应用内完成；冲突处理仍需要真实 git 客户端，窗口内会给出可复制的命令。

### 网络状态

页面顶端有两枚状态灯，启动时自动检测：

- **系统网络**：Android 通过原生 `ConnectivityManager` 桥接读取；其他平台使用 `navigator.onLine`，并监听 online / offline 事件与定时轮询。
- **GitHub 可达性**：实际探测 `api.github.com/rate_limit`，收到状态码小于 500 的响应即视为连接正常；点击状态灯可随时重新检测，GitHub 请求失败时也会自动复检。

绿色 = 正常，红色 = 不可用，蓝色脉冲 = 检测中。

### 仓库配置

`editor-config.json`（仓库根）决定 Content owner / repo / branch、Release 仓库与保留路径。构建时 `npm run config:sync` 生成带 SHA-256 与 owner 白名单的 `app/assets/js/editor-config.js`，`npm run config:check` 校验两者一致；运行时若远程配置哈希变化，会先过白名单再应用，未通过则回退内置配置。


### 有效语法高亮（CodeMirror 6）

- 使用本地打包的 **CodeMirror 6**，不是透明 textarea 叠加层：真实编辑器状态、行号、活动行、括号匹配、选区与撤销栈。
- Markdown / GFM：标题、粗体、斜体、删除线、链接、列表、引用、代码、分隔线等使用主题化颜色。
- Wiki 标记额外高亮：
  - `[[File/…]]` 正文图片
  - `[[页面|显示文字]]` 站内链接
  - `[icon=…]` 内联图标
  - `:::warning[标题] … :::` 横幅（整行底色 + 左边框）
  - Markdown 表格行
  - `[bg=…;fg=…]` 表格单元格颜色标记
- 「元数据 YAML」标签使用 **YAML 语法高亮**。
- 围栏代码块按语言高亮：JS/TS、JSON、CSS、HTML、YAML。
- 配色同时适配亮色 / 暗色主题。
- **搜索与替换**：`Ctrl/Cmd+F` 打开查找面板，`Ctrl/Cmd+H` 直接查找替换；支持大小写、正则、整词匹配，匹配处与选中内容会高亮。
- **自动补全**：输入 `[[` 补全仓库中的页面 id，`[icon=` 补全当前游戏的图标名，frontmatter 的 `tags` 补全内置分类；括号自动闭合。
- **行内诊断**：路径 / frontmatter / Wiki 语法 / 图标 / 音频 / 站内链接问题以波浪线 + 行号栏标记显示，悬停可看说明。

![语法高亮](docs/screenshots/syntax-highlighting.png)

### Content 页面编辑

- 页面路径校验：`games/<游戏>/<分类>/…/<页面>.md`；拦截保留路径、非法字符、扩展名大小写等问题。
- frontmatter 表单：`title` / `description` / `tags` / `order` / `draft` / `updated` / `toc`，保留未知字段与注释；排序 / 日期 / 草稿 / 目录收进可折叠的「更多选项」。
- 页面分类（`tags`）使用模板 chip 选择，未知分类会在本地预检与内容门禁中被拒绝；新增分类请走 issue 模板。
- 音频插入：仅支持 `.ogg`，语法 `[[Audio/名称.ogg|标题]]`，文件放在 `games/<游戏>/assets/audio/`；可随 PR 上传，预览点击后加载并显示来源与失败原因。
- 嵌入播放器：语法 `[[Embed/youtube/ID|标题]]`，粘贴完整链接后先显示来源 / 视频 ID / 标题供确认，再转换为短标记；预览中显示来源与「打开原链接」降级入口；其他来源会被门禁拒绝。
- 一键格式：粗体插入 `****` 并把光标放在中间；斜体、删除线、行内代码同理；支持标题、引用、列表、任务列表、代码块、标准 Markdown 链接。
- 表格生成器：任意数据行数 × 列数（1–50 × 1–12）、表头、对齐、紧凑格式、**自定义单元格填充模板**（`{r}` / `{c}` / `{r0}` / `{c0}`）与高级源码模板。
- 图片插入：任意图片格式；可选 Wiki `[[File/…]]`、标准 Markdown `![]()` 或自定义模板；可随 PR 上传到 `games/<游戏>/assets/images/`。
- 图标插入：`[icon=…]` 从 `games/<游戏>/assets/icons/` 读取；对话框会检查图标文件是否存在，并可把新图标随 PR 上传到同一目录。
- 横幅、图标、表格颜色、站内链接都有对应插入对话框。
- 粘贴或拖入图片即可加入「待上传资源」并插入 `[[File/名称|md]]`；超过 1 MB 的位图会缩放到长边 1600px 以内并转为 WebP。
- **多草稿**：草稿按仓库路径分别保存，最近 30 份可直接读取，更早的自动移入本机归档（IndexedDB）并可恢复；「最近草稿」支持导出 / 导入 JSON 备份。加载 / 浏览切换 / 新建前会提示保存或放弃未保存的修改。
- 本地草稿自动保存；`Ctrl+S` 立即保存；`Ctrl+Z` / `Ctrl+Shift+Z` 撤销重做；支持导出当前文件。

### 按需预览（非实时）

预览按钮或 `Ctrl+Enter` 生成快照；支持桌面 / 手机宽度、页内目录、亮暗主题、横幅、表格颜色、Wiki 图片、图标、音频与嵌入播放器、站内链接。本次会话上传的图片 / 音频可直接预览；仓库已有图片显示文件名与 alt 占位，点击后才按需加载（不预取）。嵌入块显示来源标识与「若无法播放，请点此打开原链接」；音频加载失败会给出原因与「打开原文件」入口。

### GitHub PR（纯客户端）

- token **默认只保留在内存**；勾选「记住 token」后加密保存在本机（Android Keystore / 其他平台 AES-256-GCM），启动时自动恢复并验证。GitHub 请求直接发往 `https://api.github.com`；嵌入标题查询只访问 YouTube / Vimeo 的 oEmbed 接口，不携带 token。
- 目标仓库由 `editor-config.json` 决定（默认 `hellokug2699/Wikifactory-Content`）；网络层会拒绝配置之外的其他仓库名。
- 有写权限时直接从最新 base 创建临时分支并提交；没有写权限时自动 Fork → 同步 Fork → 向 Content 仓库发起 PR。
- 一次 PR 可同时提交正文与多个图片 / 音频；支持 Draft PR、自定义分支名 / 提交信息 / PR 标题与说明。
- **PR 模板**：变更类型（新增页面 / 修改内容 / 修复引用）+ 必填说明；提交信息、PR 标题与 PR 说明自动带出模板，仍可手动修改。
- **内容差异预览**：PR 窗口展示加载时的原始内容与当前编辑内容的行级差异（+ / − 行数、上下文折叠、路径变更提示）。
- **离线 / 弱网**：文件树缓存在本机（7 天，按分支区分）；GitHub 请求 20 秒超时；网络不可用时存在性校验回退到缓存并标注「可能过期」，PR 窗口可先「保存草稿」。
- **分支名由用户保留**：编辑器不会自动追加后缀；若分支名被占用，冲突窗口会给出「内容页-日期-短哈希」建议名并支持一键更换。
- **提交前本地门禁**：进入 PR 前会刷新 `Wikifactory-Content` 的文件树，执行路径层级、frontmatter 类型、`[icon=]` 图标 / `[[Audio/…]]` 音频存在性、重复 URL / 大小写冲突检查；有错误时阻断提交，并给出具体文件与行号。`[[页面]]` 目标缺失只给警告，不阻断。
- **Content 仓库不要求分支 up-to-date**：编辑器不检查也不阻塞；每次从最新 base 创建分支。
- 成功后显示 PR 链接，可复制链接。

### 自动删除已合并分支

仓库新增 [.github/workflows/delete-merged-branches.yml](.github/workflows/delete-merged-branches.yml)：PR 合并后自动删除**本仓库内**的 head 分支（`main` / `master` / `develop` 除外）。

> Fork PR 的 head 分支位于贡献者自己的仓库，上游 `GITHUB_TOKEN` 无权删除；贡献者可在自己的 Fork 设置中开启 “Automatically delete head branches”，或在合并后手动删除。

### 移动端

- 侧栏抽屉、底部操作面板、可横向滚动的格式栏。
- CodeMirror 编辑区字号 ≥ 16px、行高 1.8；行号栏可设为自动 / 显示 / 隐藏，移动端默认隐藏，底部始终显示「行 当前/总行数」。
- 触控目标优化；宽表在预览中横向滚动；已在 320 / 360 / 390 宽度实测无页面级横向溢出。

## 截图

| 亮色主界面 | 暗色主界面 |
| --- | --- |
| ![亮色](docs/screenshots/desktop-main-light.png) | ![暗色](docs/screenshots/desktop-main-dark.png) |

| 预览 | 移动端（语法高亮） |
| --- | --- |
| ![预览](docs/screenshots/desktop-preview-light.png) | ![移动端](docs/screenshots/mobile-syntax.png) |

| YAML 元数据高亮 | 图片插入 |
| --- | --- |
| ![YAML](docs/screenshots/syntax-highlighting-yaml.png) | ![图片](docs/screenshots/image-dialog.png) |

| 提交 PR |
| --- |
| ![PR](docs/screenshots/pr-dialog.png) |

更多截图见 [`docs/screenshots/`](docs/screenshots/)。

## 快速使用

1. 打开应用，点击右上角「未连接」或齿轮 → 填写 GitHub token。
2. 在左侧填写 Content 页面路径（例如 `games/Satisfactory/Buildings/MAM.md`），点「浏览」从仓库选择文件，或点「加载」按路径读取。
3. 在左侧填写元数据，在编辑区写 Markdown；用工具栏插入横幅、表格、图片、图标、站内链接。
4. 点「预览」检查最终页面。
5. 点「提交 PR」，选择变更类型、填写必填说明，查看内容差异，确认分支名 / 提交信息 / PR 标题后创建 PR。

### Token 获取步骤（贡献者必读）

1. 打开 [GitHub → Settings → Developer settings → Personal access tokens (classic)](https://github.com/settings/tokens/new)。
2. Note 填 `Wikifactory Editor`，Expiration 选择合适期限。
3. 勾选 `public_repo`（公开仓库读写）。这是推荐方式。
4. 点击 Generate token，复制一次并粘贴到编辑器设置中。
5. 保存设置并点击「测试连接」，确认显示你的 `@用户名`。

> **公开仓库 ≠ 可以直接推送。** 绝大多数贡献者没有 `Wikifactory-Content` 的写权限；编辑器会自动先 Fork 到你的账户，再把分支推送到你的 Fork，并向 `hellokug2699/Wikifactory-Content` 发起 PR。只有维护者才可能直接在上游建分支。
>
> 若使用 Fine-grained token，需要对你 Fork 的 Content 仓库拥有 Contents / Pull requests 读写权限；若无法创建 Fork，请改用经典 token 的 `public_repo`。

### Token 权限

| 仓库 | 经典 token | 细粒度 token |
| --- | --- | --- |
| `Wikifactory-Content`（公开） | `public_repo`（提交 PR）/ 匿名读取也可 | 目标仓库的 Contents: Read and write、Pull requests: Read and write |

> 没有写权限时会自动走 Fork；Fork 由 GitHub 账户完成，公开仓库通常只需要 `public_repo`。
> token 默认只保留在内存；勾选「记住 token」后加密保存在本机（Android Keystore / 其他平台 AES-256-GCM），启动时自动恢复。输入框不提供「显示」按钮，并阻止复制 / 剪切 / 拖拽，但**允许粘贴**。应用没有后端，不会把 token 发往 GitHub 以外的地址。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + S` | 保存本地草稿 |
| `Ctrl/Cmd + F` | 查找（面板内可切换大小写 / 正则 / 整词） |
| `Ctrl/Cmd + H` | 查找并替换 |
| `Ctrl/Cmd + I` | 斜体（插入 `**`，光标居中） |
| `Ctrl/Cmd + K` | 插入 Markdown 链接 |
| `Ctrl/Cmd + Shift + K` | 插入站内链接 `[[…]]` 并弹出页面补全 |
| `Ctrl/Cmd + Space` | 手动触发补全 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Ctrl/Cmd + Shift + Z` 或 `Ctrl + Y` | 重做 |
| `Ctrl/Cmd + B` | 粗体（插入 `****`，光标居中） |
| `Ctrl/Cmd + Enter` | 生成预览快照 |
| `Esc` | 关闭预览 / 弹窗 / 补全 / 查找面板 / 移动端侧栏 |

## 支持的 Wiki 语法

```md
---
title: 页面标题
description: 摘要
tags: [攻略, 建筑]
order: 10
updated: 2026-10-13
toc: true
---

:::warning[注意]
横幅正文，支持 **加粗**。
:::

[[File/iron-plate.png|thumb|md|right|alt=铁板|铁板的物品图标]]
[[File/iron-plate.png;thumb;md]]          ← 表格内用 ; 分隔选项

[icon=iron-plate;size=lg;bg=&G] 铁板

[[Satisfactory/Buildings/MAM|MAM 建筑]]

[[Audio/factory-ambient.ogg|工厂环境音]]

[[Embed/youtube/dQw4w9WgXcQ|官方预告片]]

| 名称 | 数量 |
| --- | --- |
| 铁锭 | [bg=&G;fg=#ffffff]42 |
```

- 图片目录：`games/<游戏>/assets/images/`；图标目录：`games/<游戏>/assets/icons/`；音频目录：`games/<游戏>/assets/audio/`（仅 `.ogg`）。
- 嵌入来源：YouTube / 哔哩哔哩 / Vimeo；编辑器会把完整链接转换为 `youtube/ID`、`bilibili/BV号` 或 `vimeo/ID`。
- 表格颜色支持快捷色名 `&R` `&O` `&Y` `&G` `&B` `&P` `&K`（以及 `&red` 等长名）。
- 图片尺寸预设：`sm` / `md` / `lg` / `full`；对齐：`left` / `center` / `right`。
- 正文图片请使用 `File/` 而不是 `File:`（避免与 `:::warning` 指令冲突）。

## 目录结构

```
app/                 静态 Web 应用（无框架、离线可用）
  assets/css/        界面与 CodeMirror 主题样式
  assets/js/         编辑器适配、Wiki 预览、校验、共享内容规则与页面分类模板、GitHub 客户端
  assets/vendor/     CodeMirror 6 bundle、marked、DOMPurify、Neutralino 客户端
desktop/             Neutralinojs 桌面壳配置
android/             Android WebView 壳（Gradle）
scripts/             构建、vendor bundle、共享规则同步、release 签名与自测脚本
docs/screenshots/    README 截图
dist/                交付产物（Windows 便携 ZIP / 签名 APK / web zip）
```

## 构建

环境要求：

- Node.js ≥ 20、npm
- `curl`、`unzip`、`zip`（桌面 / 网页构建）
- Android：JDK **21**、Android SDK Platform 35、Build-Tools 35.0.0、Gradle 8.9+
  - AGP 8.7 不支持 JDK 25；请设置 `JAVA_HOME` 指向 JDK 21。
  - 设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，或在脚本可访问 `/opt/android-sdk`。

```bash
npm install
npm run build:vendor    # 重新打包 CodeMirror 6（依赖变更后执行）
npm run lint            # ESLint + Prettier 检查（CI 同款）
npm test                # 内容规则 / frontmatter / Wiki 语法 / 草稿 / GitHub PR mock
npm run build:web       # dist/Wikifactory-Editor-<version>-web.zip
npm run build:desktop   # 生成 Windows 便携 ZIP（exe + resources.neu，可自签名）
npm run build:android   # 生成 debug-signed APK（需 Android SDK）

# 共享内容规则（与内容仓库同源）
npm run rules:hash                    # 打印当前共享规则的 sha256
npm run rules:sync -- ../Wikifactory-Content   # 写入 content-rules.mjs + 校验和
npm run rules:check -- ../Wikifactory-Content  # 校验副本是否被手改

# 页面分类模板（同步到站点配置）
npm run tags:sync -- ../site           # 生成 config/page-tags.json
npm run tags:check -- ../site          # 校验站点副本是否过期

# Release 签名（需要 ANDROID_KEYSTORE 等环境变量，见「Android 签名」）
npm run build:android:release
```

桌面构建会在 `desktop/bin/` 缓存 Neutralinojs 二进制（已忽略），通过 `neu build --release` 生成 `resources.neu`，再把 exe 与资源一起打包成 ZIP；设置 `WINDOWS_SIGNING_P12` 等变量时会自动做 Authenticode 签名。

代码风格由 [eslint.config.js](eslint.config.js)（flat config）与 [.prettierrc.json](.prettierrc.json) 约束；`npm run lint:fix` 可自动修复。`content-rules.js` 与内容仓库逐字节同源，已加入 Prettier 忽略列表，任何格式化都会破坏哈希校验。`.gitattributes` 统一 LF 行尾，Windows 检出不会再把生成文件校验 / Prettier 检查弄失败。`.github/workflows/ci.yml` 在 push 与 PR 上运行 `npm ci && npm run lint && npm test`（Ubuntu + Windows），并单独跑 Playwright 主链路。

Android 壳通过 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net` 加载本地静态文件，因此 `localStorage`、`fetch` 与 CORS 行为与普通浏览器一致；网络请求只发往 `api.github.com`（GitHub API）、`raw.githubusercontent.com`（远程配置 / 更新清单）、`github.com` 与 `objects.githubusercontent.com` / `release-assets.githubusercontent.com`（更新下载）以及 YouTube / Vimeo 的 oEmbed 标题接口。

## 已知限制

- 预览是按需快照，不是实时渲染；仓库中已有的图片显示文件名 / alt，点击后才按需加载（本次会话上传的图片可直接预览）。
- 音频同样按需加载；嵌入播放器需要网络，且实际播放取决于提供商是否允许 iframe 嵌入。预览中已提供来源标识与原链接降级入口，但无法检测 iframe 内部的播放失败。
- 嵌入标题通过 YouTube / Vimeo 的 oEmbed 读取；哔哩哔哩不提供可用的跨域标题接口，标题需手动填写。
- 离线缓存只覆盖文件树（图标 / 音频 / 站内链接存在性）；没有网络时无法读取文件正文或提交 PR，请先保存草稿。
- `[[` 页面补全、`[icon=` 图标补全与图标存在性诊断都依赖仓库文件树；完全离线且没有缓存时只会退回本地语法检查（路径、frontmatter、Wiki 语法）。
- 多草稿只保存正文与 frontmatter，不包含「待上传资源」；切换草稿或页面后需要重新选择图片 / 音频。
- 站内链接校验基于文件路径与文件名，无法读取页面 frontmatter 标题或页面别名，因此只给警告、不阻断。
- 批量重命名的链接改写以同游戏目录为范围，最多扫描 200 个页面；超出时窗口会明确提示，未扫描页面的链接需要手工确认。
- 远程 `editor-config.json` 指向其他仓库时，必须在侧栏「编辑范围」中确认后才会启用；确认结果按配置哈希记忆在本机。
- Android App Links 依赖 `https://wikifactory.top/.well-known/assetlinks.json`；若该文件未部署或证书不匹配，系统会退回「用其他应用打开」的询问框。更换签名证书后必须同步更新该文件。
- Android 只发布 CI 签名版 APK；`npm run build:android` 生成的 debug 包仅用于本地测试，不会进入 Release。没有接入 Play Store / 自动更新（更新方式 0 只会下载并提示安装）。
- Windows 版以 ZIP 分发（exe + `resources.neu`），必须解压后运行；依赖 WebView2 Runtime（Windows 10/11 通常自带）。exe 为自签名，SmartScreen 仍会提示未知发布者。桌面自动更新从 GitHub Releases 下载 `resources.neu`，完整性依赖 HTTPS 与 GitHub Release 的发布流程，编辑器侧不做二次签名校验。
- `npm run test:e2e` 需要本机 Chromium（Playwright 缓存、系统 Chrome/Edge 或 `PW_CHROME`）；CI 会安装并在缺少浏览器时直接失败，本地默认跳过。
- 仓库 git 历史中仍保留 v1.2.3 之前的 APK / exe（约 17 MB）；`dist/` 已停止入库，如需缩小 clone 体积可择机重写历史。
- 若 GitHub 的 Content 仓库启用了 “Require branches to be up to date” 分支保护，仍需在仓库设置中关闭；编辑器侧本身不做该限制。

## 安全说明

- token 默认加密保存在本机：Android 使用 Android Keystore（密钥不可导出），网页 / Windows 使用由本机安装标识派生的 AES-256-GCM 密钥，存储中只有密文与随机 IV，不存在明文 token。
- 关闭「记住 token」时 token 只留在内存；离开共享设备前请使用设置中的「清除 token」。
- token 输入框不提供显示按钮，并阻止复制、剪切与拖拽；粘贴可用，但请勿自行截图或粘贴到其他位置。
- 注意：网页 / Windows 的加密密钥由本机可见信息派生，能运行调试工具的攻击者仍可能解密，属于提高门槛而非硬件隔离；Android Keystore 提供真正的不可导出密钥。
- 网络层只允许当前配置的 Content 仓库（默认 `Wikifactory-Content`）；其他仓库名会被直接拒绝。远程配置若要把仓库改到别处，必须通过 owner 白名单与客户端显式确认。
- 启动检查更新只访问 `api.github.com`（Release 元数据）、`raw.githubusercontent.com`（更新清单）与 GitHub Releases（下载），不会发送 token；更新方式为 0 时桌面端会自动下载资源包，Android 会打开签名 APK 的下载地址（安装仍需用户确认）。
- 建议为编辑器单独创建最小权限 token，并定期在 GitHub 设置中撤销。
- 公开仓库内不要提交任何 token、密钥或个人隐私信息。

## 许可

[MIT](LICENSE)
