# 生词本

`v2.2.2` · Windows · Electron · React · TypeScript · SQLite · 内置 Local AI

生词本是一款本地优先的英语词汇管理桌面应用。它把收藏、编辑、分类、独立复习和词素分析集中在一个简洁的 Windows 桌面界面中；词库保存在本机，内置 Local AI 负责基础释义，DeepSeek 和本地词根辞典均为可选增强。

![生词本主界面](docs/images/app-overview.jpg)

## 核心能力

- 收藏单个英文单词或最多 8 个英文 token 组成的短语；单词继续规范常见复数，短语只规范空白并按完整表达独立保存。
- 自动模式下短语优先由 DeepSeek 生成整体释义，云端不可用时回退到内置 Local AI 并标记为待核对；`welfare check`、`look up`、`take care of` 等常见表达带离线安全校验，组成词只作为辅助理解，不会被拆成词根。
- 安装完成后无需 API Key、DeepSeek 或联网，即可获得 Word 基础中文释义和 Phrase 候选释义；短语类型、组成词提示及解释会在小模型返回有效结构时展示，未可靠识别的表达可人工修订或交给 DeepSeek 增强。
- Local AI 使用内嵌的 Qwen3-0.6B Q8_0 GGUF 和 llama.cpp；本地模型不生成 IPA、词源或复杂标签，Word 词根仍由本地词根辞典处理。
- 编辑词汇文本、英式 IPA、多个词性与中文释义、主分类和标签；字段有效时会自动保存。
- 搜索单词或短语、IPA、释义、分类、标签、短语类型、短语组成说明和词素，并按最近更新、A–Z 或记忆曲线排序。
- 在独立 Review Mode 中先回忆英文词汇，再显示答案，用 `1`–`4` 选择“忘记、困难、记得、简单”；普通点击词卡只查看和编辑，不会记录复习。
- 可选用 DeepSeek 自动补全 IPA、释义、分类、标签和构词分析，再与本地词根辞典核验；无法确认的词素会明确标记为 AI 解析。

此外，应用提供 Due + New 复习队列、每日新词上限、四档透明间隔算法、复习历史、AI 队列暂停与重试、回收站、自动更新、每日 SQLite 备份，以及 JSON、CSV、SQLite 导出。

## 安装

项目当前发布 Windows NSIS 安装包。

1. 打开 [GitHub Releases](https://github.com/Kiasma1/shengciben/releases)。
2. 下载 Latest Release 中的 `shengciben-setup-x.y.z.exe`。
3. 运行安装程序并选择安装目录。

卸载应用不会主动删除词库数据。

### 从源码运行

需要 Node.js 22 和 npm。

```powershell
git clone https://github.com/Kiasma1/shengciben.git
cd shengciben
npm ci
npm run dev
```

构建 Windows 安装包：

```powershell
npm run build:win
```

安装包生成在 `release/` 目录，当前文件名为 `shengciben-setup-2.2.2.exe`。安装包会把模型和 llama-server 放在外部 `resources/local-ai/`，不放进 `app.asar`。

GitHub Release 支持可选的 Authenticode 代码签名。配置 `WINDOWS_CERTIFICATE_BASE64`（Base64 编码的 PFX）和 `WINDOWS_CERTIFICATE_PASSWORD` 后，流水线会签名并验证安装包；没有证书时仍会发布未签名安装包，并在发布说明中明确提示 SmartScreen 或“未知发布者”警告。发版前会依次运行自动测试、生产依赖安全审计和 TypeScript 构建。

## 使用

1. 点击“添加词汇”或按 `Ctrl+N` 使用主窗口；也可以随时按 `Ctrl+Shift+Alt+W` 打开快速收词，直接提交剪贴板内容、多行词表或 CSV/TXT/Anki 文本导出。
2. 在中栏搜索、筛选或排序；按 `Ctrl+K` 可直接聚焦搜索框。点击词条只会打开详情，不会改变复习状态。
3. 在右栏编辑词汇文本、IPA、义项、分类和标签；字段有效时会自动保存。
4. 点击左侧“开始复习”，进入独立复习页面：先看英文词汇，按 `Space` 或点击“显示答案”，再用 `1`–`4` 评分。
5. 复习中按 `Esc` 可退出；已评分的词条会立即保存，剩余词条下次重新从数据库构建队列。

在 Windows 上关闭主窗口会让应用留在系统托盘，方便全局快捷键继续工作；需要彻底退出时，右键托盘图标并选择“退出”。

Review Mode 的队列包含全部到期词，以及每日上限允许加入的新词。Word 和 Phrase 共用同一套 Review 算法、历史表和评分快捷键；Phrase Reveal 后优先显示整体释义、使用说明和组成词。

## 配置

### Local AI 与 DeepSeek

默认 AI 模式为“自动：Word 本地 / Phrase DeepSeek”。Word 使用内嵌 Qwen3-0.6B；Phrase 在 DeepSeek 可用时优先调用 DeepSeek，API Key 缺失、网络失败、余额不足或服务不可用时回退到本地 AI，并标记为“本地基础解析 · 建议核对”。也可以在“设置 → AI 模式”选择“仅本地 AI”、“DeepSeek 优先：失败时本地回退”或“仅 DeepSeek”。

内置 Local AI：

- 模型：Qwen3-0.6B Q8_0 GGUF
- 运行时：llama.cpp `b8162` 的 Windows CPU runtime
- 自动分流：Word 本地处理；Phrase 优先 DeepSeek，失败时回退本地 AI
- 不需要账户、API Key 或网络；应用启动时会启动本地 AI 进程并通过 health check，关闭应用时自动清理
- 开发环境可用 `LOCAL_AI_MODEL_PATH` 和 `LOCAL_AI_SERVER_PATH` 覆盖模型与 runtime 路径

模型和 runtime 的许可证与固定版本、SHA256 记录在 [`local-ai/README.md`](local-ai/README.md)。

### DeepSeek 高级增强

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)创建 API Key。
2. 打开“设置 → AI 模式”，选择“自动：Word 本地 / Phrase DeepSeek（推荐）”或“仅 DeepSeek”，填写 API Key 和 API 地址。
3. 点击“检测 DeepSeek”，从接口返回的可用模型中选择模型并保存。

默认 API 地址为 `https://api.deepseek.com`，默认模型为 `deepseek-v4-flash`。API Key 通过 Electron `safeStorage` 加密后写入本机，设置界面不会回显已保存的 Key。

后台队列每次处理一个词条。Word 会继续执行词素与本地词根核验；Phrase 只执行整体表达分析，不进入词根 pipeline。自动模式下，Phrase 的 DeepSeek 请求失败后会立即回退本地 AI；“仅 DeepSeek”模式中的可重试网络或限流错误最多自动重试 10 次。也可以暂停队列、手动重试词条，或在设置中重新分析全部词条。HTTP 402 余额不足不会重试。重新分析会保留用户手动编辑的释义和标签。

### 复习

在“设置 → 复习”中配置“每日新词上限”，范围为 `0–100`，默认 `20`。设为 `0` 表示当天只复习到期词。应用按本地日期统计当天已经首次学习的新词。

四档评分使用分钟作为内部单位：新词为 Again `10 分钟`、Hard `1 天`、Good `2 天`、Easy `4 天`；已有间隔时分别按 `10 分钟`、`max(1 天, previous × 1.2)`、`max(2 天, previous × 2.5)`、`max(4 天, previous × 4)` 计算，最长 `365 天`。每次评分都会保存一条复习历史。

### 本地词根辞典

打开“设置 → 词根辞典”，选择《英语词根词源分类辞典》的本地 HTML 文件并重建索引。辞典文件不包含在本仓库中。

应用会校验 AI 返回的词素是否真实出现在单词中，再将其映射到辞典词根族；Phrase 不运行这套词根分析。辞典命中项可点击跳转到原 HTML 锚点，未命中项保留为“AI 解析”。更换辞典后，只重新核验 Word。

## 数据与隐私

- 词库使用 SQLite，保存在 Electron 的系统用户数据目录；Windows 启动时会移除继承的普通用户访问权限，仅保留当前用户、SYSTEM 和管理员。词库没有额外的应用层加密，同一 Windows 账户和管理员仍可读取。可从“设置 → 数据与备份 → 打开数据目录”进入。
- 复习当前状态保存在 `words` 表，评分历史保存在 `review_events` 表；删除词条时历史记录级联删除。
- 应用启动后每小时检查一次当日备份，最多保留最近 7 个 `.sqlite` 文件。
- 可从设置导出 JSON、带 BOM 的 CSV 或完整 SQLite 备份；JSON/SQLite 保留 `entryType`、`phraseType`、`phraseComponents`、`phraseExplanation` 和 AI 来源，CSV 提供对应字段。
- 可从“设置 → 数据与备份 → 恢复 SQLite”恢复完整备份。应用会先检查备份完整性和生词本表结构，保存当前词库快照，再重启替换；新数据库无法打开时会自动回滚。
- Local AI：词汇数据只在本机处理，不会发送到网络。
- DeepSeek：仅在用户配置并启用 DeepSeek 增强时，发送必要的当前词汇内容、条目类型和现有分类名。
- AI 来源会保存在条目中并在详情显示；Phrase 使用本地 fallback 时显示“本地基础解析 · 建议核对”。
- 现有数据库会在启动时自动迁移；复习历史表的迁移幂等，不会重置已有复习状态。

## Phrase 盲测

Qwen3-0.6B 使用 50 条不在 Prompt 和 safety set 中的 Phrase 完成了固定盲测。结果为：整体意义正确 18%、基本可用 28%、机械直译 26%、明显错误 28%；正确与基本可用合计 46%，未达到 90% 通过线。因此 0.6B 只作为 Phrase 的降级候选，不作为可信首选，也不会把失败样例补进 safety set。

评测集、原始模型输出、逐条人工评分和哈希见 [`evaluations/phrase-blind-v1-report.md`](evaluations/phrase-blind-v1-report.md)。

## 项目结构

```text
src/
├─ main/       Electron 主进程、SQLite、复习算法、Review API、Local AI、AI 队列与词根索引
├─ preload/    受限 IPC 接口
├─ renderer/   React 界面、Review Mode 与样式
└─ shared/     共享 TypeScript 类型与词汇输入规则
local-ai/      内置 Local AI 版本、SHA256 与第三方许可证说明
scripts/       release 构建资源准备脚本
tests/         数据库、短语、复习、归一化、Local AI、AI 队列、导出与词根索引测试
.github/       基于 v* tag 的 Windows 自动发布流程
build/         应用图标与构建时 Local AI 资源缓存
```

## 开发与验证

```powershell
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
npm run build
```

本机已准备 Local AI 资源时，可以复现 50 条 Phrase 盲测；CPU 推理约需 10–15 分钟，脚本支持断点续跑：

```powershell
npm run eval:phrases:blind
```

使用本地辞典执行词根随机审计：

```powershell
npm run test:roots:random -- "D:\path\to\dictionary.html"
```

## 许可证

[MIT](LICENSE)
