import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import path from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { AppDatabase } from './database'
import { checkOllama } from './ollama'
import { QueueProcessor } from './queue-processor'
import { RootIndexer } from './root-indexer'
import type { AppSettings, WordDraft, WordFilters } from '../shared/types'

let windowRef: BrowserWindow | null = null
let database: AppDatabase
let rootIndexer: RootIndexer
let processor: QueueProcessor

const notifyChanged = (): void => windowRef?.webContents.send('words:changed')

async function refreshRootMatches(wordId: string): Promise<void> {
  const entry = database.getWord(wordId)
  if (!entry) return
  const settings = database.getSettings()
  const matches = await rootIndexer.match(entry.word, settings.dictionaryPath)
  database.setRootMatches(wordId, matches)
  notifyChanged()
}

function createWindow(): void {
  windowRef = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: '生词本',
    backgroundColor: '#fcfaf5',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  windowRef.on('closed', () => {
    windowRef = null
  })

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

function setupIpc(): void {
  ipcMain.handle('words:list', (_event, filters: WordFilters) => database.listWords(filters))
  ipcMain.handle('words:get', (_event, id: string) => database.getWord(id))
  ipcMain.handle('words:create', (_event, word: string) => {
    const result = database.createWord(word)
    notifyChanged()
    void refreshRootMatches(result.entry.id)
    void processor.processNext()
    return result
  })
  ipcMain.handle('words:save', (_event, draft: WordDraft) => {
    const entry = database.saveWord(draft)
    notifyChanged()
    void refreshRootMatches(entry.id)
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
  ipcMain.handle('settings:get', () => database.getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    const saved = database.saveSettings(settings)
    notifyChanged()
    void rootIndexer.ensure(saved.dictionaryPath).then(notifyChanged).catch(notifyChanged)
    void processor.processNext()
    return saved
  })
  ipcMain.handle('ollama:check', () => checkOllama(database.getSettings().ollamaUrl))
  ipcMain.handle('queue:retry', (_event, wordId: string) => {
    database.retryTask(wordId)
    notifyChanged()
    void processor.processNext()
  })
  ipcMain.handle('roots:status', () => rootIndexer.currentStatus(database.getSettings().dictionaryPath))
  ipcMain.handle('roots:rebuild', async () => {
    const status = await rootIndexer.rebuild(database.getSettings().dictionaryPath)
    notifyChanged()
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
  ipcMain.handle('data:export', async () => {
    const options: SaveDialogOptions = {
      title: '导出生词本数据库备份',
      defaultPath: 'shengciben-backup.sqlite',
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
    }
    const result = windowRef ? await dialog.showSaveDialog(windowRef, options) : await dialog.showSaveDialog(options)
    if (!result.canceled && result.filePath) await database.backup(result.filePath)
  })
}

app.whenReady().then(async () => {
  app.setName('生词本')
  database = new AppDatabase(app.getPath('userData'))
  rootIndexer = new RootIndexer(database.directory)
  processor = new QueueProcessor(database, rootIndexer, notifyChanged)
  setupIpc()
  createWindow()
  processor.start()
  void rootIndexer.ensure(database.getSettings().dictionaryPath).then(notifyChanged).catch(notifyChanged)
  try {
    await backupIfNeeded()
  } catch {
    // A missed backup must not block access to the user's wordbook.
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => processor?.stop())
