import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ExportFormat, WordDraft, WordFilters } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
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
  words: {
    list: (filters: WordFilters) => ipcRenderer.invoke('words:list', filters),
    get: (id: string) => ipcRenderer.invoke('words:get', id),
    create: (word: string) => ipcRenderer.invoke('words:create', word),
    save: (draft: WordDraft) => ipcRenderer.invoke('words:save', draft),
    trash: (id: string) => ipcRenderer.invoke('words:trash', id),
    restore: (id: string) => ipcRenderer.invoke('words:restore', id)
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (name: string, color: string) => ipcRenderer.invoke('categories:create', name, color),
    delete: (id: string) => ipcRenderer.invoke('categories:delete', id)
  },
  tags: { list: () => ipcRenderer.invoke('tags:list') },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings)
  },
  ollama: { check: (url?: string) => ipcRenderer.invoke('ollama:check', url) },
  queue: {
    status: () => ipcRenderer.invoke('queue:status'),
    setPaused: (paused: boolean) => ipcRenderer.invoke('queue:set-paused', paused),
    retry: (wordId: string) => ipcRenderer.invoke('queue:retry', wordId)
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
