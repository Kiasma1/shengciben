export type EnrichmentStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type RootMatchMode = 'exact' | 'lemma' | 'morpheme' | 'ai'
export type MorphemeKind = 'prefix' | 'root' | 'suffix'
export type MorphemeSource = 'dictionary' | 'ai'

export interface AiMorpheme {
  kind: MorphemeKind
  form: string
  canonicalForm: string
  meaning: string
}

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
  surfaceForm: string
  kind: MorphemeKind
  meaning: string
  formationNote: string
  source: MorphemeSource
  sourceAnchor: string
  sourceLabel: string
  matchedVia: RootMatchMode
  sortOrder: number
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
  aiMorphemes: AiMorpheme[]
  formationSummary: string
  rootMatches: RootMatch[]
  status: EnrichmentStatus
  aiError: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  lastReviewedAt: string | null
  reviewCount: number
  nextReviewAt: string | null
}

export interface WordFilters {
  query?: string
  categoryId?: string | null
  status?: EnrichmentStatus | 'all'
  sort?: 'recent' | 'alphabetical' | 'due'
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
  aiProvider: 'deepseek'
  deepseekApiUrl: string
  deepseekModel: string
  deepseekApiKey: string
  dictionaryPath: string
}

export interface AppSettingsView {
  aiProvider: 'deepseek'
  deepseekApiUrl: string
  deepseekModel: string
  deepseekApiKey: string
  hasDeepseekApiKey: boolean
  clearDeepseekApiKey: boolean
  dictionaryPath: string
}

export interface DeepSeekStatus {
  available: boolean
  models: string[]
  message: string
}

export interface AiEnrichment {
  ipaUk: string
  senses: WordSense[]
  suggestedCategory: string | null
  tagNames: string[]
  morphemes: AiMorpheme[]
  formationSummary: string
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
