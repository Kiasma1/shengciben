/// <reference types="vite/client" />

import type {
  AppSettings,
  Category,
  ExportFormat,
  OllamaStatus,
  QueueStatus,
  RootIndexStatus,
  Tag,
  WordCreateResult,
  WordDraft,
  WordEntry,
  WordFilters
} from '../../shared/types'

declare global {
  interface Window {
    api: {
      window: {
        isMaximized: () => Promise<boolean>
        minimize: () => void
        toggleMaximize: () => void
        close: () => void
        onMaximizedChanged: (listener: (maximized: boolean) => void) => () => void
      }
      words: {
        list: (filters: WordFilters) => Promise<WordEntry[]>
        get: (id: string) => Promise<WordEntry | null>
        create: (word: string) => Promise<WordCreateResult>
        save: (draft: WordDraft) => Promise<WordEntry>
        trash: (id: string) => Promise<void>
        restore: (id: string) => Promise<void>
        emptyTrash: () => Promise<number>
      }
      categories: {
        list: () => Promise<Category[]>
        create: (name: string, color: string) => Promise<Category>
        delete: (id: string) => Promise<void>
      }
      tags: { list: () => Promise<Tag[]> }
      settings: {
        get: () => Promise<AppSettings>
        save: (settings: AppSettings) => Promise<AppSettings>
      }
      ollama: { check: (url?: string) => Promise<OllamaStatus> }
      queue: {
        status: () => Promise<QueueStatus>
        setPaused: (paused: boolean) => Promise<QueueStatus>
        retry: (wordId: string) => Promise<void>
      }
      roots: {
        status: () => Promise<RootIndexStatus>
        rebuild: () => Promise<RootIndexStatus>
        chooseFile: () => Promise<string | null>
        openSource: (anchor: string) => Promise<void>
      }
      data: {
        openFolder: () => Promise<string>
        export: (format: ExportFormat) => Promise<boolean>
      }
      onWordsChanged: (listener: () => void) => () => void
    }
  }
}

export {}
