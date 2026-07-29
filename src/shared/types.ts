export type EnrichmentStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type RootMatchMode = 'exact' | 'lemma'

export interface Category {
  id: string
  name: string
  color: string
  wordCount: number
}

export interface Tag {
  id: string
  name: string
}

export interface WordSense {
  id?: string
  partOfSpeech: string
  definitionZh: string
}

export interface RootMatch {
  id?: string
  root: string
  meaning: string
  formationNote: string
  sourceAnchor: string
  sourceLabel: string
  matchedVia: RootMatchMode
}

export interface WordEntry {
  id: string
  word: string
  normalizedWord: string
  ipaUk: string
  senses: WordSense[]
  categoryId: string
  categoryName: string
  categoryColor: string
  tags: Tag[]
  rootMatches: RootMatch[]
  status: EnrichmentStatus
  aiError: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface WordFilters {
  query?: string
  categoryId?: string | null
  status?: EnrichmentStatus | 'all'
  sort?: 'recent' | 'alphabetical'
  includeDeleted?: boolean
}

export interface WordDraft {
  id: string
  word: string
  ipaUk: string
  senses: WordSense[]
  categoryId: string
  tagNames: string[]
}

export interface AppSettings {
  aiProvider: 'ollama'
  ollamaUrl: string
  ollamaModel: string
  dictionaryPath: string
}

export interface OllamaStatus {
  available: boolean
  models: string[]
  message: string
}

export interface AiEnrichment {
  ipaUk: string
  senses: WordSense[]
  suggestedCategory: string | null
  tagNames: string[]
}

export interface RootIndexStatus {
  sourcePath: string
  indexedWords: number
  updatedAt: string | null
  ready: boolean
  message: string
}

export interface WordCreateResult {
  entry: WordEntry
  duplicate: boolean
}

export interface QueueStatus {
  pending: number
  processing: number
  failed: number
  paused: boolean
}

export type ExportFormat = 'sqlite' | 'json' | 'csv'
