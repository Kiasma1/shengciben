import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync, mkdirSync, promises as fs, readdirSync, statSync, unlinkSync } from 'node:fs'
import { AiProviderRegistry } from './ai-provider'
import { wordsToCsv } from './data-export'
import { AppDatabase, normalizeDailyNewLimit, type SecretCodec } from './database'
import { DeepSeekProvider } from './deepseek'
import { QueueProcessor } from './queue-processor'
import { RootIndexer } from './root-indexer'
import type { AppSettings, AppSettingsView, ExportFormat, ReviewRating, WordDraft, WordFilters } from '../shared/types'

let windowRef: BrowserWindow | null = null
let database: AppDatabase
let rootIndexer: RootIndexer
let processor: QueueProcessor
let providers: AiProviderRegistry
let backupTimer: NodeJS.Timeout | null = null

const notifyChanged = (): void => windowRef?.webContents.send('words:changed')
const secretCodec: SecretCodec = {
  encode: (value) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 DeepSeek API Key。')
    return `safe:v1:${safeStorage.encryptString(value).toString('base64')}`
  },
  decode: (value) => {
    if (!value.startsWith('safe:v1:')) return value
    try {
      return safeStorage.decryptString(Buffer.from(value.slice('safe:v1:'.length), 'base64'))
    } catch {
      return ''
    }
  }
}
const toSettingsView = (settings: AppSettings): AppSettingsView => ({
  aiProvider: 'deepseek',
  deepseekApiUrl: settings.deepseekApiUrl,
  deepseekModel: settings.deepseekModel,
  deepseekApiKey: '',
  hasDeepseekApiKey: Boolean(settings.deepseekApiKey),
  clearDeepseekApiKey: false,
  dictionaryPath: settings.dictionaryPath,
  dailyNewLimit: settings.dailyNewLimit
})
const mergeSettingsView = (view: AppSettingsView): AppSettings => {
  const current = database.getSettings()
  return {
    aiProvider: 'deepseek',
    deepseekApiUrl: view.deepseekApiUrl.trim(),
    deepseekModel: view.deepseekModel.trim() || 'deepseek-v4-flash',
    deepseekApiKey: view.clearDeepseekApiKey ? '' : view.deepseekApiKey.trim() || current.deepseekApiKey,
    dictionaryPath: view.dictionaryPath.trim(),
    dailyNewLimit: normalizeDailyNewLimit(view.dailyNewLimit)
  }
}

async function refreshRootMatches(wordId: string): Promise<void> {
  const entry = database.getWord(wordId)
  if (!entry) return
  if (entry.entryType === 'phrase') {
    database.setRootMatches(wordId, [])
    notifyChanged()
    return
  }
  const settings = database.getSettings()
  const matches = entry.aiMorphemes.length
    ? await rootIndexer.reconcile(entry.word, entry.aiMorphemes, settings.dictionaryPath)
    : await rootIndexer.match(entry.word, settings.dictionaryPath)
  database.setRootMatches(wordId, matches)
  notifyChanged()
}

async function refreshAllRootMatches(): Promise<void> {
  const settings = database.getSettings()
  await rootIndexer.ensure(settings.dictionaryPath)
  for (const target of database.listRootRefreshTargets()) {
    const entry = database.getWord(target.id)
    if (!entry) continue
    const matches = entry.aiMorphemes.length
      ? await rootIndexer.reconcile(entry.word, entry.aiMorphemes, settings.dictionaryPath)
      : await rootIndexer.match(entry.word, settings.dictionaryPath)
    database.setRootMatches(entry.id, matches)
  }
  notifyChanged()
}

function scheduleRootRefresh(wordId: string): void {
  void refreshRootMatches(wordId).catch((error: unknown) => {
    console.error('词根索引刷新失败：', error)
    notifyChanged()
  })
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: '生词本',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f2f2',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  windowRef.on('closed', () => {
    windowRef = null
  })
  windowRef.on('maximize', () => windowRef?.webContents.send('window:maximized-changed', true))
  windowRef.on('unmaximize', () => windowRef?.webContents.send('window:maximized-changed', false))

  if (process.env.ELECTRON_RENDERER_URL) {
    void windowRef.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void windowRef.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function backupIfNeeded(): Promise<void> {
  const backupDirectory = path.join(database.directory, 'backups')
  mkdirSync(backupDirectory, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const target = path.join(backupDirectory, `shengciben-${today}.sqlite`)
  if (!existsSync(target)) await database.backup(target)

  const oldBackups = readdirSync(backupDirectory)
    .map((name) => ({ name, fullPath: path.join(backupDirectory, name) }))
    .filter((item) => item.name.endsWith('.sqlite'))
    .sort((left, right) => statSync(right.fullPath).mtimeMs - statSync(left.fullPath).mtimeMs)
    .slice(7)
  oldBackups.forEach((backup) => unlinkSync(backup.fullPath))
}

function startBackupSchedule(): void {
  backupTimer ??= setInterval(() => {
    void backupIfNeeded().catch((error: unknown) => console.error('自动备份失败：', error))
  }, 60 * 60 * 1000)
}

function stopBackupSchedule(): void {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
}

function setupIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.on('update:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) return
    if (target.isMaximized()) target.unmaximize()
    else target.maximize()
  })
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('words:list', (_event, filters: WordFilters) => database.listWords(filters))
  ipcMain.handle('words:get', (_event, id: string) => database.getWord(id))
  ipcMain.handle('words:get-by-normalized', (_event, word: string) => database.getWordByNormalized(word))
  ipcMain.handle('words:create', (_event, word: string) => {
    const result = database.createWord(word)
    notifyChanged()
    scheduleRootRefresh(result.entry.id)
    void processor.processNext()
    return result
  })
  ipcMain.handle('words:save', (_event, draft: WordDraft) => {
    const entry = database.saveWord(draft)
    notifyChanged()
    scheduleRootRefresh(entry.id)
    return entry
  })
  ipcMain.handle('words:trash', (_event, id: string) => {
    database.trashWord(id)
    notifyChanged()
  })
  ipcMain.handle('words:restore', (_event, id: string) => {
    database.restoreWord(id)
    notifyChanged()
  })
  ipcMain.handle('reviews:overview', () => database.getReviewOverview())
  ipcMain.handle('reviews:queue', () => database.getReviewQueue())
  ipcMain.handle('reviews:grade', (_event, id: string, rating: ReviewRating) => {
    const result = database.gradeReview(id, rating)
    notifyChanged()
    return result
  })
  ipcMain.handle('words:empty-trash', () => {
    const deletedCount = database.emptyTrash()
    notifyChanged()
    return deletedCount
  })
  ipcMain.handle('categories:list', () => database.listCategories())
  ipcMain.handle('categories:create', (_event, name: string, color: string) => {
    const category = database.createCategory(name, color)
    notifyChanged()
    return category
  })
  ipcMain.handle('categories:delete', (_event, id: string) => {
    database.deleteCategory(id)
    notifyChanged()
  })
  ipcMain.handle('tags:list', () => database.listTags())
  ipcMain.handle('settings:get', () => toSettingsView(database.getSettings()))
  ipcMain.handle('settings:save', (_event, view: AppSettingsView) => {
    const saved = database.saveSettings(mergeSettingsView(view))
    notifyChanged()
    void refreshAllRootMatches().catch((error: unknown) => {
      console.error('全部词根关联刷新失败：', error)
      notifyChanged()
    })
    void processor.processNext()
    return toSettingsView(saved)
  })
  ipcMain.handle('deepseek:check', (_event, view: AppSettingsView) => {
    return providers.get('deepseek').check(mergeSettingsView(view))
  })
  ipcMain.handle('queue:status', () => processor.getStatus())
  ipcMain.handle('queue:set-paused', (_event, paused: boolean) => processor.setPaused(paused))
  ipcMain.handle('queue:retry', (_event, wordId: string) => {
    database.retryTask(wordId)
    notifyChanged()
    void processor.processNext()
  })
  ipcMain.handle('queue:reanalyse-all', () => {
    const queuedCount = database.reanalyseAllWords()
    notifyChanged()
    void processor.processNext()
    return queuedCount
  })
  ipcMain.handle('roots:status', () => rootIndexer.currentStatus(database.getSettings().dictionaryPath))
  ipcMain.handle('roots:rebuild', async () => {
    const status = await rootIndexer.rebuild(database.getSettings().dictionaryPath)
    await refreshAllRootMatches()
    return status
  })
  ipcMain.handle('roots:choose-file', async () => {
    const options: OpenDialogOptions = {
      title: '选择英语词根词源分类辞典 HTML 文件',
      properties: ['openFile'],
      filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]
    }
    const result = windowRef ? await dialog.showOpenDialog(windowRef, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('roots:open-source', async (_event, anchor: string) => {
    const source = database.getSettings().dictionaryPath
    if (!source || !existsSync(source)) throw new Error('词根辞典文件不可访问。')
    await shell.openExternal(`file:///${source.replace(/\\/g, '/')}#${encodeURIComponent(anchor)}`)
  })
  ipcMain.handle('data:open-folder', () => shell.openPath(database.directory))
  ipcMain.handle('data:export', async (_event, format: ExportFormat = 'sqlite') => {
    const exportOptions: Record<ExportFormat, { title: string; defaultPath: string; filterName: string; extension: string }> = {
      sqlite: { title: '导出生词本数据库备份', defaultPath: 'shengciben-backup.sqlite', filterName: 'SQLite 数据库', extension: 'sqlite' },
      json: { title: '导出生词本 JSON', defaultPath: 'shengciben-words.json', filterName: 'JSON 文件', extension: 'json' },
      csv: { title: '导出生词本 CSV', defaultPath: 'shengciben-words.csv', filterName: 'CSV 文件', extension: 'csv' }
    }
    const selected = exportOptions[format]
    const options: SaveDialogOptions = {
      title: selected.title,
      defaultPath: selected.defaultPath,
      filters: [{ name: selected.filterName, extensions: [selected.extension] }]
    }
    const result = windowRef ? await dialog.showSaveDialog(windowRef, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    if (format === 'sqlite') {
      await database.backup(result.filePath)
      return true
    }
    const snapshot = database.exportSnapshot()
    const content = format === 'json' ? JSON.stringify(snapshot, null, 2) : wordsToCsv(snapshot.words)
    await fs.writeFile(result.filePath, content, 'utf8')
    return true
  })
}

// 双开实例会同时轮询任务表，重复调用 DeepSeek 计费，因此强制单实例
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!windowRef) return
    if (windowRef.isMinimized()) windowRef.restore()
    windowRef.focus()
  })
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return
  app.setName('生词本')
  Menu.setApplicationMenu(null)
  database = new AppDatabase(app.getPath('userData'), secretCodec)
  rootIndexer = new RootIndexer(database.directory)
  providers = new AiProviderRegistry([new DeepSeekProvider()])
  processor = new QueueProcessor(
    database,
    providers,
    notifyChanged,
    (word, morphemes) => rootIndexer.reconcile(word, morphemes, database.getSettings().dictionaryPath)
  )
  setupIpc()
  createWindow()
  processor.start()
  void refreshAllRootMatches().catch((error: unknown) => {
    console.error('词根索引初始化失败：', error)
    notifyChanged()
  })
  try {
    await backupIfNeeded()
  } catch {
    // A missed backup must not block access to the user's wordbook.
  }
  startBackupSchedule()

  // 静默检查更新：失败不打扰使用；下载完成后通知渲染进程提示重启安装
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    windowRef?.webContents.send('update:available', info.version)
  })
  void autoUpdater.checkForUpdates().catch(() => {
    // 更新检查失败静默处理（离线/网络问题不阻塞启动）
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  processor?.stop()
  stopBackupSchedule()
})
