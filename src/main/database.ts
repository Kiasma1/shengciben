import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
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

const UNCATEGORIZED_ID = 'uncategorized'
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
  enrichment_status: EnrichmentStatus
  ai_error: string | null
  is_deleted: number
  created_at: string
  updated_at: string
}

const now = (): string => new Date().toISOString()
const normalizeWord = (value: string): string => value.trim().toLocaleLowerCase('en-US')

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
        meaning TEXT NOT NULL,
        formation_note TEXT NOT NULL DEFAULT '',
        source_anchor TEXT NOT NULL,
        source_label TEXT NOT NULL,
        matched_via TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
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
        lower(w.word) LIKE @query OR lower(w.ipa_uk) LIKE @query OR lower(c.name) LIKE @query OR
        EXISTS (SELECT 1 FROM senses s WHERE s.word_id = w.id AND (lower(s.part_of_speech) LIKE @query OR lower(s.definition_zh) LIKE @query)) OR
        EXISTS (SELECT 1 FROM word_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.word_id = w.id AND lower(t.name) LIKE @query) OR
        EXISTS (SELECT 1 FROM root_matches rm WHERE rm.word_id = w.id AND (lower(rm.root) LIKE @query OR lower(rm.meaning) LIKE @query))
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
    const word = rawWord.trim()
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
        .prepare(`INSERT INTO tasks (id, word_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`)
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
      .prepare(`SELECT id AS taskId, word_id AS wordId FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
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
    } else {
      this.db.prepare('INSERT INTO tasks (id, word_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), wordId, 'pending', now(), now())
    }
    this.db.prepare(`UPDATE words SET enrichment_status = 'pending', ai_error = NULL, updated_at = ? WHERE id = ?`).run(now(), wordId)
  }

  applyEnrichment(wordId: string, result: { ipaUk: string; senses: WordSense[]; suggestedCategory: string | null; tagNames: string[] }): void {
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
        .prepare(`UPDATE words SET ipa_uk = ?, category_id = ?, enrichment_status = 'ready', ai_error = NULL, ai_reviewed = 1, suggested_category = NULL, updated_at = ? WHERE id = ?`)
        .run(result.ipaUk, categoryId, now(), wordId)
      this.replaceSenses(wordId, result.senses)
      this.replaceTags(wordId, result.tagNames)
    })
    transaction()
  }

  setRootMatches(wordId: string, matches: RootMatch[]): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM root_matches WHERE word_id = ?').run(wordId)
      const insert = this.db.prepare(`INSERT INTO root_matches (id, word_id, root, meaning, formation_note, source_anchor, source_label, matched_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      matches.forEach((match) =>
        insert.run(randomUUID(), wordId, match.root, match.meaning, match.formationNote, match.sourceAnchor, match.sourceLabel, match.matchedVia)
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
      .prepare(`SELECT id, root, meaning, formation_note AS formationNote, source_anchor AS sourceAnchor, source_label AS sourceLabel, matched_via AS matchedVia FROM root_matches WHERE word_id = ?`)
      .all(row.id) as RootMatch[]
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
      rootMatches,
      status: row.enrichment_status,
      aiError: row.ai_error,
      isDeleted: Boolean(row.is_deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
