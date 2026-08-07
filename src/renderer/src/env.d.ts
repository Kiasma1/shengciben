/// <reference types="vite/client" />

import type {
  AppSettingsView,
  Category,
  DeepSeekStatus,
  ExportFormat,
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
      app: {
        version: () => Promise<string>
      }
      updates: {
        install: () => void
        onAvailable: (listener: (version: string) => void) => () => void
      }
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
        get: () => Promise<AppSettingsView>
        save: (settings: AppSettingsView) => Promise<AppSettingsView>
      }
      deepseek: { check: (settings: AppSettingsView) => Promise<DeepSeekStatus> }
      queue: {
        status: () => Promise<QueueStatus>
        setPaused: (paused: boolean) => Promise<QueueStatus>
        retry: (wordId: string) => Promise<void>
        reanalyseAll: () => Promise<number>
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
