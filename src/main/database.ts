import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  AiEnrichment,
  AiMorpheme,
  Category,
  EnrichmentStatus,
  QueueStatus,
  RootMatch,
  Tag,
  WordCreateResult,
  WordDraft,
  WordEntry,
  WordFilters,
  WordSense
} from '../shared/types'
import pluralize from 'pluralize'

const UNCATEGORIZED_ID = 'uncategorized'
const MORPHOLOGY_VERSION = 1
const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: 'deepseek',
  deepseekApiUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-v4-flash',
  deepseekApiKey: '',
  dictionaryPath: ''
}

export interface SecretCodec {
  encode(value: string): string
  decode(value: string): string
}

const identitySecretCodec: SecretCodec = {
  encode: (value) => value,
  decode: (value) => value
}

type WordRow = {
  id: string
  word: string
  normalized_word: string
  ipa_uk: string
  category_id: string
  category_name: string
  category_color: string
  ai_morphemes_json: string
  formation_summary: string
  enrichment_status: EnrichmentStatus
  ai_error: string | null
  is_deleted: number
  created_at: string
  updated_at: string
}

const now = (): string => new Date().toISOString()
const normalizeWord = (value: string): string => value.trim().toLocaleLowerCase('en-US')

// pluralize 库的规则覆盖不了的词，手动修正
const PLURAL_OVERRIDES: Record<string, string> = {
  // 以 -ie 结尾的词加 s 后同样以 -ies 结尾，规则会误判成 -y
  cookies: 'cookie',
  calories: 'calorie',
  brownies: 'brownie',
  selfies: 'selfie',
  genies: 'genie',
  collies: 'collie',
  rookies: 'rookie',
  // 现代用法中作不可数名词处理
  data: 'data',
  media: 'media'
}

// pluralize 库未覆盖的以 -ics 结尾的不可数名词，保持原样
const UNCOUNTABLE_ICS = new Set([
  'physics', 'mathematics', 'economics', 'politics', 'statistics',
  'ethics', 'gymnastics', 'linguistics', 'electronics', 'mechanics',
  'optics', 'genetics', 'aesthetics', 'athletics', 'classics'
])

// 专有名词白名单（键为小写）：这些词保留用户输入的大小写，不强制转小写。
// 收录常用国家/地区、语言、民族、主要城市、月份、星期；未收录的专有名词按默认规则转小写。
// ponytail: 静态列表，覆盖面有限；若需要完整支持可换成词典/实体库查询。
const PROPER_NOUNS = new Set([
  // 国家/地区
  'china', 'japan', 'korea', 'america', 'usa', 'uk', 'britain', 'england', 'scotland', 'wales', 'ireland',
  'france', 'germany', 'italy', 'spain', 'portugal', 'greece', 'russia', 'ukraine', 'poland', 'sweden',
  'norway', 'denmark', 'finland', 'iceland', 'netherlands', 'belgium', 'switzerland', 'austria', 'hungary',
  'romania', 'bulgaria', 'czech', 'slovakia', 'croatia', 'serbia', 'turkey', 'israel', 'egypt', 'morocco',
  'algeria', 'tunisia', 'nigeria', 'kenya', 'ethiopia', 'ghana', 'canada', 'mexico', 'brazil', 'argentina',
  'chile', 'peru', 'colombia', 'venezuela', 'cuba', 'india', 'pakistan', 'bangladesh', 'nepal', 'thailand',
  'vietnam', 'malaysia', 'singapore', 'indonesia', 'philippines', 'australia', 'fiji', 'iran', 'iraq',
  'afghanistan', 'qatar', 'kuwait', 'jordan', 'syria', 'lebanon', 'mongolia', 'kazakhstan', 'uzbekistan',
  'taiwan', 'tibet', 'macau', 'cyprus', 'barbados', 'maldives', 'jamaica', 'haiti', 'bahamas', 'bermuda',
  'greenland', 'antarctica',
  // 语言/民族
  'english', 'chinese', 'japanese', 'korean', 'french', 'german', 'italian', 'spanish', 'portuguese',
  'russian', 'arabic', 'hindi', 'dutch', 'greek', 'latin', 'swedish', 'norwegian', 'danish', 'finnish',
  'polish', 'turkish', 'thai', 'vietnamese', 'hebrew', 'urdu', 'bengali', 'malay', 'indonesian',
  'tagalog', 'persian', 'ukrainian', 'romanian', 'hungarian', 'gaelic', 'welsh', 'irish',
  'american', 'british', 'canadian', 'mexican', 'brazilian', 'argentine', 'chilean', 'colombian',
  'peruvian', 'cuban', 'indian', 'pakistani', 'nepali', 'malaysian', 'singaporean', 'filipino',
  'philippine', 'australian', 'scottish', 'belgian', 'swiss', 'austrian', 'slovak', 'croatian',
  'serbian', 'bulgarian', 'israeli', 'egyptian', 'moroccan', 'algerian', 'tunisian', 'nigerian',
  'kenyan', 'ethiopian', 'ghanaian', 'african', 'asian', 'european', 'arab',
  // 主要城市
  'london', 'paris', 'tokyo', 'beijing', 'shanghai', 'moscow', 'rome', 'berlin', 'madrid', 'lisbon',
  'athens', 'vienna', 'amsterdam', 'brussels', 'zurich', 'geneva', 'stockholm', 'oslo', 'copenhagen',
  'helsinki', 'warsaw', 'prague', 'budapest', 'kiev', 'istanbul', 'cairo', 'jerusalem', 'riyadh',
  'dubai', 'tehran', 'baghdad', 'karachi', 'mumbai', 'delhi', 'bangkok', 'hanoi', 'manila', 'jakarta',
  'seoul', 'sydney', 'melbourne', 'auckland', 'toronto', 'vancouver', 'montreal', 'washington', 'chicago',
  'boston', 'miami', 'houston', 'seattle', 'lagos', 'nairobi', 'casablanca', 'marrakech', 'dublin',
  'edinburgh', 'manchester', 'munich', 'naples', 'venice', 'florence', 'barcelona',
  // 月份/星期
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
])

/**
 * 规范用户输入的单词：去除首尾与多余空格；字母默认全部转小写，
 * 专有名词（国家、语言、民族、主要城市、月份、星期等）保留用户输入的大小写；
 * 单个单词自动把复数转为单数。多词短语（如 "ad hoc"）保留内部空格，原样返回。
 */
export const normalizeWordInput = (raw: string): string => {
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  if (cleaned.includes(' ')) return cleaned
  const lower = cleaned.toLocaleLowerCase('en-US')
  if (PROPER_NOUNS.has(lower)) return cleaned
  if (UNCOUNTABLE_ICS.has(lower)) return lower
  const singular = PLURAL_OVERRIDES[lower] ?? pluralize.singular(cleaned)
  const singularLower = singular.toLocaleLowerCase('en-US')
  return PROPER_NOUNS.has(singularLower) ? singular : singularLower
}

export class AppDatabase {
  private readonly db: Database.Database
  private readonly secretCodec: SecretCodec
  readonly directory: string
  readonly filePath: string

  constructor(directory: string, secretCodec: SecretCodec = identitySecretCodec) {
    this.directory = directory
    this.secretCodec = secretCodec
    mkdirSync(directory, { recursive: true })
    this.filePath = path.join(directory, 'shengciben.sqlite')
    this.db = new Database(this.filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initialize()
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS words (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        normalized_word TEXT NOT NULL UNIQUE,
        ipa_uk TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL REFERENCES categories(id),
        enrichment_status TEXT NOT NULL DEFAULT 'pending',
        ai_error TEXT,
        ai_reviewed INTEGER NOT NULL DEFAULT 0,
        suggested_category TEXT,
        ai_morphemes_json TEXT NOT NULL DEFAULT '[]',
        formation_summary TEXT NOT NULL DEFAULT '',
        morphology_version INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS senses (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        part_of_speech TEXT NOT NULL,
        definition_zh TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS word_tags (
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (word_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS root_matches (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        root TEXT NOT NULL,
        surface_form TEXT NOT NULL DEFAULT '',
        morpheme_kind TEXT NOT NULL DEFAULT 'root',
        meaning TEXT NOT NULL,
        formation_note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'dictionary',
        source_anchor TEXT NOT NULL,
        source_label TEXT NOT NULL,
        matched_via TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 100,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_words_active_updated ON words(is_deleted, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
    `)

    const rootColumns = this.db.pragma('table_info(root_matches)') as { name: string }[]
    if (!rootColumns.some((column) => column.name === 'formation_note')) {
      this.db.exec(`ALTER TABLE root_matches ADD COLUMN formation_note TEXT NOT NULL DEFAULT ''`)
    }
    if (!rootColumns.some((column) => column.name === 'surface_form')) {
      this.db.exec(`ALTER TABLE root_matches ADD COLUMN surface_form TEXT NOT NULL DEFAULT ''`)
    }
    if (!rootColumns.some((column) => column.name === 'morpheme_kind')) {
      this.db.exec(`ALTER TABLE root_matches ADD COLUMN morpheme_kind TEXT NOT NULL DEFAULT 'root'`)
    }
    if (!rootColumns.some((column) => column.name === 'source')) {
      this.db.exec(`ALTER TABLE root_matches ADD COLUMN source TEXT NOT NULL DEFAULT 'dictionary'`)
    }
    if (!rootColumns.some((column) => column.name === 'sort_order')) {
      this.db.exec(`ALTER TABLE root_matches ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
    }
    this.db.prepare(`UPDATE root_matches SET surface_form = root WHERE trim(surface_form) = ''`).run()
    const wordColumns = this.db.pragma('table_info(words)') as { name: string }[]
    const needsMorphologyBackfill = !wordColumns.some((column) => column.name === 'morphology_version')
    if (!wordColumns.some((column) => column.name === 'ai_morphemes_json')) {
      this.db.exec(`ALTER TABLE words ADD COLUMN ai_morphemes_json TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!wordColumns.some((column) => column.name === 'formation_summary')) {
      this.db.exec(`ALTER TABLE words ADD COLUMN formation_summary TEXT NOT NULL DEFAULT ''`)
    }
    if (needsMorphologyBackfill) {
      this.db.exec(`ALTER TABLE words ADD COLUMN morphology_version INTEGER NOT NULL DEFAULT 0`)
    }
    const taskColumns = this.db.pragma('table_info(tasks)') as { name: string }[]
    if (!taskColumns.some((column) => column.name === 'priority')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 100`)
    }

    this.db
      .prepare('INSERT OR IGNORE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(UNCATEGORIZED_ID, '未分类', '#8a6b42', now())

    const insertSetting = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value)
    }

    this.db.transaction(() => {
      this.db.prepare(`UPDATE settings SET value = 'deepseek' WHERE key = 'aiProvider'`).run()
      this.db.prepare(`DELETE FROM settings WHERE key IN ('ollamaUrl', 'ollamaModel')`).run()
      this.db.prepare(`UPDATE tasks SET status = 'pending', error = NULL, updated_at = ? WHERE status = 'processing'`).run(now())
      this.db.prepare(`UPDATE words SET enrichment_status = 'pending', ai_error = NULL, updated_at = ? WHERE enrichment_status = 'processing'`).run(now())
      const legacySuggestions = this.db
        .prepare(`SELECT id, trim(suggested_category) AS categoryName FROM words WHERE enrichment_status = 'needs_review' AND category_id = ? AND trim(coalesce(suggested_category, '')) <> ''`)
        .all(UNCATEGORIZED_ID) as { id: string; categoryName: string }[]
      const insertCategory = this.db.prepare('INSERT OR IGNORE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      const findCategory = this.db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE')
      const applyCategory = this.db.prepare('UPDATE words SET category_id = ? WHERE id = ?')
      for (const suggestion of legacySuggestions) {
        insertCategory.run(randomUUID(), suggestion.categoryName, '#6e6e6e', now())
        const category = findCategory.get(suggestion.categoryName) as { id: string }
        applyCategory.run(category.id, suggestion.id)
      }
      this.db.prepare(`UPDATE words SET enrichment_status = 'ready', ai_reviewed = 1, suggested_category = NULL, updated_at = ? WHERE enrichment_status = 'needs_review'`).run(now())
      if (needsMorphologyBackfill) {
        const missingTasks = this.db
          .prepare(`SELECT w.id FROM words w LEFT JOIN tasks t ON t.word_id = w.id WHERE w.is_deleted = 0 AND t.id IS NULL`)
          .all() as { id: string }[]
        const insertTask = this.db.prepare(`INSERT INTO tasks (id, word_id, status, priority, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?)`)
        for (const word of missingTasks) insertTask.run(randomUUID(), word.id, now(), now())
        this.db.prepare(`UPDATE tasks SET status = 'pending', priority = 0, error = NULL, updated_at = ? WHERE word_id IN (SELECT id FROM words WHERE is_deleted = 0)`).run(now())
        this.db.prepare(`UPDATE words SET enrichment_status = 'pending', ai_error = NULL, morphology_version = 0, updated_at = ? WHERE is_deleted = 0`).run(now())
      }
    })()
  }

  listWords(filters: WordFilters = {}): WordEntry[] {
    const clauses = ['w.is_deleted = @isDeleted']
    const params: Record<string, string | number> = {
      isDeleted: filters.includeDeleted ? 1 : 0,
      query: `%${filters.query?.trim().toLocaleLowerCase('en-US') ?? ''}%`
    }

    if (filters.categoryId) {
      clauses.push('w.category_id = @categoryId')
      params.categoryId = filters.categoryId
    }
    if (filters.status && filters.status !== 'all') {
      clauses.push('w.enrichment_status = @status')
      params.status = filters.status
    }
    if (filters.query?.trim()) {
      clauses.push(`(
        lower(w.word) LIKE @query OR lower(w.ipa_uk) LIKE @query OR lower(w.formation_summary) LIKE @query OR lower(c.name) LIKE @query OR
        EXISTS (SELECT 1 FROM senses s WHERE s.word_id = w.id AND (lower(s.part_of_speech) LIKE @query OR lower(s.definition_zh) LIKE @query)) OR
        EXISTS (SELECT 1 FROM word_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.word_id = w.id AND lower(t.name) LIKE @query) OR
        EXISTS (SELECT 1 FROM root_matches rm WHERE rm.word_id = w.id AND (lower(rm.root) LIKE @query OR lower(rm.surface_form) LIKE @query OR lower(rm.meaning) LIKE @query OR lower(rm.formation_note) LIKE @query))
      )`)
    }

    const order = filters.sort === 'alphabetical' ? 'w.normalized_word ASC' : 'w.updated_at DESC'
    const rows = this.db
      .prepare(`
        SELECT w.*, c.name AS category_name, c.color AS category_color
        FROM words w JOIN categories c ON c.id = w.category_id
        WHERE ${clauses.join(' AND ')} ORDER BY ${order}
      `)
      .all(params) as WordRow[]
    return rows.map((row) => this.hydrateWord(row))
  }

  listRootRefreshTargets(): { id: string; word: string }[] {
    return this.db.prepare('SELECT id, word FROM words').all() as { id: string; word: string }[]
  }

  getWord(id: string): WordEntry | null {
    const row = this.db
      .prepare(`
        SELECT w.*, c.name AS category_name, c.color AS category_color
        FROM words w JOIN categories c ON c.id = w.category_id WHERE w.id = ?
      `)
      .get(id) as WordRow | undefined
    return row ? this.hydrateWord(row) : null
  }

  createWord(rawWord: string): WordCreateResult {
    const word = normalizeWordInput(rawWord)
    const normalizedWord = normalizeWord(word)
    if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) {
      throw new Error('请输入单个英文单词；可包含连字符或撇号。')
    }

    const existing = this.db.prepare('SELECT id FROM words WHERE normalized_word = ?').get(normalizedWord) as { id: string } | undefined
    if (existing) {
      const entry = this.getWord(existing.id)
      if (!entry) throw new Error('读取重复单词失败。')
      return { entry, duplicate: true }
    }

    const id = randomUUID()
    const createdAt = now()
    const insert = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO words (id, word, normalized_word, category_id, enrichment_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .run(id, word, normalizedWord, UNCATEGORIZED_ID, createdAt, createdAt)
      this.db
        .prepare(`INSERT INTO tasks (id, word_id, status, priority, created_at, updated_at) VALUES (?, ?, 'pending', 100, ?, ?)`)
        .run(randomUUID(), id, createdAt, createdAt)
    })
    insert()
    const entry = this.getWord(id)
    if (!entry) throw new Error('新建单词失败。')
    return { entry, duplicate: false }
  }

  saveWord(draft: WordDraft): WordEntry {
    const word = draft.word.trim()
    const normalizedWord = normalizeWord(word)
    if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) throw new Error('请输入单个英文单词；可包含连字符或撇号。')
    if (!this.db.prepare('SELECT id FROM categories WHERE id = ?').get(draft.categoryId)) throw new Error('所选分类不存在。')

    const cleanSenses = draft.senses
      .map((sense) => ({ partOfSpeech: sense.partOfSpeech.trim(), definitionZh: sense.definitionZh.trim() }))
      .filter((sense) => sense.partOfSpeech || sense.definitionZh)
    if (cleanSenses.some((sense) => !sense.partOfSpeech || !sense.definitionZh)) throw new Error('每个义项都需要词性和中文释义。')

    const update = this.db.transaction(() => {
      try {
        this.db
          .prepare(`UPDATE words SET word = ?, normalized_word = ?, ipa_uk = ?, category_id = ?, enrichment_status = 'ready', ai_error = NULL, ai_reviewed = 1, suggested_category = NULL, updated_at = ? WHERE id = ?`)
          .run(
            word,
            normalizedWord,
            draft.ipaUk.trim(),
            draft.categoryId,
            now(),
            draft.id
          )
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE')) throw new Error('该单词已存在。')
        throw error
      }
      this.replaceSenses(draft.id, cleanSenses)
      this.replaceTags(draft.id, draft.tagNames)
      this.db.prepare(`UPDATE tasks SET status = 'completed', error = NULL, updated_at = ? WHERE word_id = ?`).run(now(), draft.id)
    })
    update()
    const entry = this.getWord(draft.id)
    if (!entry) throw new Error('保存单词失败。')
    return entry
  }

  trashWord(id: string): void {
    this.db.prepare(`UPDATE words SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id)
  }

  restoreWord(id: string): void {
    this.db.prepare(`UPDATE words SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id)
  }

  emptyTrash(): number {
    return this.db.prepare(`DELETE FROM words WHERE is_deleted = 1`).run().changes
  }

  listCategories(): Category[] {
    return this.db
      .prepare(`
        SELECT c.id, c.name, c.color, count(w.id) AS wordCount
        FROM categories c LEFT JOIN words w ON w.category_id = c.id AND w.is_deleted = 0
        GROUP BY c.id ORDER BY CASE WHEN c.id = '${UNCATEGORIZED_ID}' THEN 0 ELSE 1 END, c.name COLLATE NOCASE
      `)
      .all() as Category[]
  }

  createCategory(name: string, color: string): Category {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('分类名称不能为空。')
    const id = randomUUID()
    try {
      this.db.prepare('INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(id, cleanName, color, now())
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new Error('已有同名分类。')
      throw error
    }
    return { id, name: cleanName, color, wordCount: 0 }
  }

  deleteCategory(id: string): void {
    if (id === UNCATEGORIZED_ID) throw new Error('“未分类”不能删除。')
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE words SET category_id = ?, updated_at = ? WHERE category_id = ?').run(UNCATEGORIZED_ID, now(), id)
      this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    })
    transaction()
  }

  listTags(): Tag[] {
    return this.db.prepare('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE').all() as Tag[]
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: keyof AppSettings; value: string }[]
    const entries = rows.map((row) => [row.key, row.value])
    const settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(entries) } as AppSettings
    settings.deepseekApiKey = settings.deepseekApiKey ? this.secretCodec.decode(settings.deepseekApiKey) : ''
    return settings
  }

  saveSettings(settings: AppSettings): AppSettings {
    const statement = this.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        const cleanValue = value.trim()
        statement.run(key, key === 'deepseekApiKey' && cleanValue ? this.secretCodec.encode(cleanValue) : cleanValue)
      }
    })
    transaction()
    return this.getSettings()
  }

  nextPendingTask(): { taskId: string; wordId: string } | null {
    const task = this.db
      .prepare(`SELECT id AS taskId, word_id AS wordId FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`)
      .get() as { taskId: string; wordId: string } | undefined
    return task ?? null
  }

  getQueueStatus(paused: boolean): QueueStatus {
    const rows = this.db
      .prepare(`SELECT status, count(*) AS count FROM tasks WHERE status IN ('pending', 'processing', 'failed') GROUP BY status`)
      .all() as { status: 'pending' | 'processing' | 'failed'; count: number }[]
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.count])) as Partial<Record<'pending' | 'processing' | 'failed', number>>
    return {
      pending: counts.pending ?? 0,
      processing: counts.processing ?? 0,
      failed: counts.failed ?? 0,
      paused
    }
  }

  isTaskProcessing(taskId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND status = 'processing'`).get(taskId))
  }

  isTaskPending(taskId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND status = 'pending'`).get(taskId))
  }

  setTaskStatus(taskId: string, status: 'pending' | 'processing' | 'failed' | 'completed', error: string | null = null): void {
    this.db.prepare('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, now(), taskId)
  }

  retryTask(wordId: string): void {
    const task = this.db.prepare('SELECT id FROM tasks WHERE word_id = ?').get(wordId) as { id: string } | undefined
    if (task) {
      this.setTaskStatus(task.id, 'pending')
      this.db.prepare(`UPDATE tasks SET priority = 100 WHERE id = ?`).run(task.id)
    } else {
      this.db.prepare('INSERT INTO tasks (id, word_id, status, priority, created_at, updated_at) VALUES (?, ?, ?, 100, ?, ?)').run(randomUUID(), wordId, 'pending', now(), now())
    }
    this.db.prepare(`UPDATE words SET enrichment_status = 'pending', ai_error = NULL, updated_at = ? WHERE id = ?`).run(now(), wordId)
  }

  reanalyseAllWords(): number {
    const activeWords = this.db.prepare(`SELECT id FROM words WHERE is_deleted = 0`).all() as { id: string }[]
    const timestamp = now()
    const transaction = this.db.transaction(() => {
      const findTask = this.db.prepare(`SELECT id FROM tasks WHERE word_id = ?`)
      const insertTask = this.db.prepare(`INSERT INTO tasks (id, word_id, status, priority, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?)`)
      const updateTask = this.db.prepare(`UPDATE tasks SET status = 'pending', priority = 0, error = NULL, updated_at = ? WHERE word_id = ?`)
      for (const word of activeWords) {
        if (findTask.get(word.id)) updateTask.run(timestamp, word.id)
        else insertTask.run(randomUUID(), word.id, timestamp, timestamp)
      }
      this.db.prepare(`UPDATE words SET enrichment_status = 'pending', ai_error = NULL, morphology_version = 0, updated_at = ? WHERE is_deleted = 0`).run(timestamp)
    })
    transaction()
    return activeWords.length
  }

  applyEnrichment(wordId: string, result: AiEnrichment): void {
    const transaction = this.db.transaction(() => {
      const current = this.getWord(wordId)
      let categoryId = current?.categoryId && current.categoryId !== UNCATEGORIZED_ID ? current.categoryId : UNCATEGORIZED_ID
      const categoryName = result.suggestedCategory?.trim()
      if (categoryId === UNCATEGORIZED_ID && categoryName) {
        this.db
          .prepare('INSERT OR IGNORE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
          .run(randomUUID(), categoryName, '#6e6e6e', now())
        categoryId = (
          this.db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(categoryName) as { id: string }
        ).id
      }
      this.db
        .prepare(`UPDATE words SET ipa_uk = ?, category_id = ?, ai_morphemes_json = ?, formation_summary = ?, morphology_version = ?, enrichment_status = 'ready', ai_error = NULL, ai_reviewed = 1, suggested_category = NULL, updated_at = ? WHERE id = ?`)
        .run(
          result.ipaUk,
          categoryId,
          JSON.stringify(result.morphemes ?? []),
          result.formationSummary?.trim() ?? '',
          MORPHOLOGY_VERSION,
          now(),
          wordId
        )
      this.replaceSenses(wordId, result.senses)
      this.replaceTags(wordId, result.tagNames)
    })
    transaction()
  }

  setRootMatches(wordId: string, matches: RootMatch[]): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM root_matches WHERE word_id = ?').run(wordId)
      const insert = this.db.prepare(`INSERT INTO root_matches (id, word_id, root, surface_form, morpheme_kind, meaning, formation_note, source, source_anchor, source_label, matched_via, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      matches.forEach((match) =>
        insert.run(
          randomUUID(),
          wordId,
          match.root,
          match.surfaceForm,
          match.kind,
          match.meaning,
          match.formationNote,
          match.source,
          match.sourceAnchor,
          match.sourceLabel,
          match.matchedVia,
          match.sortOrder
        )
      )
    })
    transaction()
  }

  setWordFailure(wordId: string, message: string): void {
    this.db.prepare(`UPDATE words SET enrichment_status = 'failed', ai_error = ?, updated_at = ? WHERE id = ?`).run(message, now(), wordId)
  }

  setWordStatus(wordId: string, status: EnrichmentStatus, error: string | null = null): void {
    this.db.prepare(`UPDATE words SET enrichment_status = ?, ai_error = ?, updated_at = ? WHERE id = ?`).run(status, error, now(), wordId)
  }

  async backup(destination: string): Promise<void> {
    await this.db.backup(destination)
  }

  exportSnapshot(): { exportedAt: string; categories: Category[]; words: WordEntry[] } {
    return {
      exportedAt: now(),
      categories: this.listCategories(),
      words: this.listWords()
    }
  }

  close(): void {
    this.db.close()
  }

  private replaceSenses(wordId: string, senses: WordSense[]): void {
    this.db.prepare('DELETE FROM senses WHERE word_id = ?').run(wordId)
    const insert = this.db.prepare('INSERT INTO senses (id, word_id, part_of_speech, definition_zh, sort_order) VALUES (?, ?, ?, ?, ?)')
    senses.forEach((sense, index) => insert.run(randomUUID(), wordId, sense.partOfSpeech, sense.definitionZh, index))
  }

  private replaceTags(wordId: string, rawNames: string[]): void {
    this.db.prepare('DELETE FROM word_tags WHERE word_id = ?').run(wordId)
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)')
    const findTag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
    const connectTag = this.db.prepare('INSERT OR IGNORE INTO word_tags (word_id, tag_id) VALUES (?, ?)')
    for (const name of [...new Set(rawNames.map((tag) => tag.trim()).filter(Boolean))]) {
      insertTag.run(randomUUID(), name, now())
      const tag = findTag.get(name) as { id: string }
      connectTag.run(wordId, tag.id)
    }
  }

  private hydrateWord(row: WordRow): WordEntry {
    const senses = this.db
      .prepare('SELECT id, part_of_speech AS partOfSpeech, definition_zh AS definitionZh FROM senses WHERE word_id = ? ORDER BY sort_order')
      .all(row.id) as WordSense[]
    const tags = this.db
      .prepare(`SELECT t.id, t.name FROM tags t JOIN word_tags wt ON wt.tag_id = t.id WHERE wt.word_id = ? ORDER BY t.name COLLATE NOCASE`)
      .all(row.id) as Tag[]
    const rootMatches = this.db
      .prepare(`SELECT id, root, surface_form AS surfaceForm, morpheme_kind AS kind, meaning, formation_note AS formationNote, source, source_anchor AS sourceAnchor, source_label AS sourceLabel, matched_via AS matchedVia, sort_order AS sortOrder FROM root_matches WHERE word_id = ? ORDER BY sort_order, rowid`)
      .all(row.id) as RootMatch[]
    let aiMorphemes: AiMorpheme[] = []
    try {
      const parsed = JSON.parse(row.ai_morphemes_json) as unknown
      if (Array.isArray(parsed)) aiMorphemes = parsed as AiMorpheme[]
    } catch {
      // Corrupt optional analysis data must not block access to the wordbook.
    }
    return {
      id: row.id,
      word: row.word,
      normalizedWord: row.normalized_word,
      ipaUk: row.ipa_uk,
      senses,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryColor: row.category_color,
      tags,
      aiMorphemes,
      formationSummary: row.formation_summary,
      rootMatches,
      status: row.enrichment_status,
      aiError: row.ai_error,
      isDeleted: Boolean(row.is_deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
