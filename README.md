# 生词本

`v2.0.0` · Windows · Electron · React · TypeScript · SQLite · DeepSeek

生词本是一款本地优先的英语词汇管理桌面应用。它把收藏、编辑、分类、复习和词素分析集中在一个三栏界面中；词库保存在本机，DeepSeek 和本地词根辞典均为可选增强。

![生词本主界面](docs/images/app-overview.jpg)

## 核心能力

- 收藏单个英文单词，自动清理大小写并将常见复数归一为单数；重复词不会重复入库。
- 编辑英式 IPA、多个词性与中文释义、主分类和标签；完整内容会自动保存。
- 搜索单词、IPA、释义、分类、标签、词素和构词说明，并按最近更新、A–Z 或复习到期时间排序。
- 点击词卡即记录一次复习；应用按简化记忆曲线安排下次复习，并用列表状态区分到期、临近和新鲜词条。
- 可选用 DeepSeek 自动补全 IPA、释义、分类、标签和构词分析，再与本地词根辞典核验；无法确认的词素会明确标记为 AI 解析。

此外，应用提供 AI 队列暂停、失败重试、批量重新分析、回收站、自动更新、每日 SQLite 备份，以及 JSON、CSV、SQLite 导出。

## 安装

项目当前发布 Windows NSIS 安装包。

1. 打开 [GitHub Releases](https://github.com/Kiasma1/shengciben/releases)。
2. 下载 `shengciben-setup-2.0.0.exe`。
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

安装包生成在 `release/` 目录，文件名为 `shengciben-setup-2.0.0.exe`。

## 使用

1. 点击“添加单词”，或按 `Ctrl+N`，输入一个英文单词并加入队列。
2. 在中栏搜索、筛选或排序；按 `Ctrl+K` 可直接聚焦搜索框。
3. 在右栏编辑 IPA、义项、分类和标签；字段有效时会自动保存。
4. 点击词卡完成复习；不再需要的词先移入回收站，可恢复或永久清空。

未配置 DeepSeek 时，单词仍会正常保存并停留在待处理队列，所有人工编辑、搜索、分类、复习和导出功能都可使用。

## 配置

### DeepSeek

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)创建 API Key。
2. 打开“设置 → DeepSeek AI”，填写 API Key 和 API 地址。
3. 点击“检测 DeepSeek”，从接口返回的可用模型中选择模型并保存。

默认 API 地址为 `https://api.deepseek.com`，默认模型为 `deepseek-v4-flash`。API Key 通过 Electron `safeStorage` 加密后写入本机，设置界面不会回显已保存的 Key。

后台队列每次处理一个单词。可重试的网络或限流错误最多自动重试 10 次，也可以暂停队列、手动重试单词，或在设置中重新分析全部词条。已有人工释义时，重新分析会保留现有释义和标签。

### 本地词根辞典

打开“设置 → 词根辞典”，选择《英语词根词源分类辞典》的本地 HTML 文件并重建索引。辞典文件不包含在本仓库中。

应用会校验 AI 返回的词素是否真实出现在单词中，再将其映射到辞典词根族；辞典命中项可点击跳转到原 HTML 锚点，未命中项保留为“AI 解析”。更换辞典后，现有词条会重新核验。

## 数据与隐私

- 词库使用 SQLite，保存在 Electron 的系统用户数据目录；可从“设置 → 数据与备份 → 打开数据目录”进入。
- 应用启动后每小时检查一次当日备份，最多保留最近 7 个 `.sqlite` 文件。
- 可从设置导出 JSON、带 BOM 的 CSV 或完整 SQLite 备份。
- AI 补全只向 DeepSeek 发送当前单词和现有分类名；应用没有账号、遥测、云同步或在线词典请求。
- 现有数据库会在启动时自动迁移；归一化后重复的词条会合并释义、标签和词根记录。

## 项目结构

```text
src/
├─ main/       Electron 主进程、SQLite、DeepSeek 队列、备份与词根索引
├─ preload/    受限 IPC 接口
├─ renderer/   React 界面与样式
└─ shared/     共享 TypeScript 类型
tests/         数据库、归一化、AI、队列、导出与词根索引测试
.github/       基于 v* tag 的 Windows 自动发布流程
build/         应用图标
```

## 开发与验证

```powershell
npm run typecheck
npm test
npm run build
```

使用本地辞典执行词根随机审计：

```powershell
npm run test:roots:random -- "D:\path\to\dictionary.html"
```

## 许可证

[MIT](LICENSE)
