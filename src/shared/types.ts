export type EnrichmentStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type RootMatchMode = 'exact' | 'lemma' | 'morpheme' | 'ai'
export type MorphemeKind = 'prefix' | 'root' | 'suffix'
export type MorphemeSource = 'dictionary' | 'ai'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type EntryType = 'word' | 'phrase'

export interface PhraseComponent {
  text: string
  meaningZh: string
}
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
  entryType: EntryType
  phraseType: string
  phraseComponents: PhraseComponent[]
  phraseExplanation: string
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
  dailyNewLimit: number
}

export interface AppSettingsView {
  aiProvider: 'deepseek'
  deepseekApiUrl: string
  deepseekModel: string
  deepseekApiKey: string
  hasDeepseekApiKey: boolean
  clearDeepseekApiKey: boolean
  dictionaryPath: string
  dailyNewLimit: number
}

export interface DeepSeekStatus {
  available: boolean
  models: string[]
  message: string
}

export interface AiEnrichment {
  entryType: EntryType
  ipaUk: string
  senses: WordSense[]
  suggestedCategory: string | null
  tagNames: string[]
  morphemes: AiMorpheme[]
  formationSummary: string
  phraseType: string
  phraseComponents: PhraseComponent[]
  phraseExplanation: string
}

export interface RootIndexStatus {
  sourcePath: string
  indexedWords: number
  updatedAt: string | null
  ready: boolean
  message: string
}

export interface ReviewOverview {
  dueCount: number
  newCount: number
  todayReviewed: number
  todayNewReviewed: number
  dailyNewLimit: number
}

export interface ReviewQueueItem {
  entry: WordEntry
  intervals: Record<ReviewRating, number>
}

export interface ReviewQueueResult {
  items: ReviewQueueItem[]
  dueCount: number
  newCount: number
}

export interface ReviewGradeResult {
  entry: WordEntry
  rating: ReviewRating
  nextReviewAt: string
  intervalMinutes: number
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
