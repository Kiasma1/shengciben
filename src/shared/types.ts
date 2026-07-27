export type EnrichmentStatus = 'pending' | 'processing' | 'needs_review' | 'ready' | 'failed'
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
  aiReviewed: boolean
  suggestedCategory: string | null
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
  aiReviewed: boolean
}

export interface AppSettings {
  ollamaUrl: string
  ollamaModel: string
  dictionaryPath: string
}

export interface OllamaStatus {
  available: boolean
  models: string[]
  message: string
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
