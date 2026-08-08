import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettingsView, ExportFormat, ReviewRating, WordDraft, WordFilters } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  app: {
    version: () => ipcRenderer.invoke('app:version')
  },
  updates: {
    install: () => ipcRenderer.send('update:install'),
    onAvailable: (listener: (version: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, version: string): void => listener(version)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    }
  },
  window: {
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizedChanged: (listener: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => listener(maximized)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    }
  },
  quickCapture: {
    submit: (text: string, sourceName?: string) => ipcRenderer.invoke('quick-capture:submit', text, sourceName),
    hide: () => ipcRenderer.send('quick-capture:hide'),
    onPrefill: (listener: (text: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, text: string): void => listener(text)
      ipcRenderer.on('quick-capture:prefill', handler)
      return () => ipcRenderer.removeListener('quick-capture:prefill', handler)
    }
  },
  words: {
    list: (filters: WordFilters) => ipcRenderer.invoke('words:list', filters),
    get: (id: string) => ipcRenderer.invoke('words:get', id),
    getByNormalized: (word: string) => ipcRenderer.invoke('words:get-by-normalized', word),
    create: (word: string) => ipcRenderer.invoke('words:create', word),
    save: (draft: WordDraft) => ipcRenderer.invoke('words:save', draft),
    trash: (id: string) => ipcRenderer.invoke('words:trash', id),
    restore: (id: string) => ipcRenderer.invoke('words:restore', id),
    emptyTrash: () => ipcRenderer.invoke('words:empty-trash')
  },
  reviews: {
    overview: () => ipcRenderer.invoke('reviews:overview'),
    queue: () => ipcRenderer.invoke('reviews:queue'),
    grade: (id: string, rating: ReviewRating) => ipcRenderer.invoke('reviews:grade', id, rating)
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (name: string, color: string) => ipcRenderer.invoke('categories:create', name, color),
    delete: (id: string) => ipcRenderer.invoke('categories:delete', id)
  },
  tags: { list: () => ipcRenderer.invoke('tags:list') },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: AppSettingsView) => ipcRenderer.invoke('settings:save', settings)
  },
  localAi: {
    status: () => ipcRenderer.invoke('local-ai:status')
  },
  deepseek: { check: (settings: AppSettingsView) => ipcRenderer.invoke('deepseek:check', settings) },
  queue: {
    status: () => ipcRenderer.invoke('queue:status'),
    setPaused: (paused: boolean) => ipcRenderer.invoke('queue:set-paused', paused),
    retry: (wordId: string) => ipcRenderer.invoke('queue:retry', wordId),
    reanalyseAll: () => ipcRenderer.invoke('queue:reanalyse-all')
  },
  roots: {
    status: () => ipcRenderer.invoke('roots:status'),
    rebuild: () => ipcRenderer.invoke('roots:rebuild'),
    chooseFile: () => ipcRenderer.invoke('roots:choose-file'),
    openSource: (anchor: string) => ipcRenderer.invoke('roots:open-source', anchor)
  },
  data: {
    openFolder: () => ipcRenderer.invoke('data:open-folder'),
    export: (format: ExportFormat) => ipcRenderer.invoke('data:export', format)
  },
  onWordsChanged: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('words:changed', handler)
    return () => ipcRenderer.removeListener('words:changed', handler)
  }
})
