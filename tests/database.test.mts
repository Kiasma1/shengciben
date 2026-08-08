import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AppDatabase, type SecretCodec } from '../src/main/database.ts'

const createDatabase = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-test-'))
  const database = new AppDatabase(directory)
  return {
    database,
    directory,
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

test('createWord 把复数规范为单数并与已有单数去重', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const first = fixture.database.createWord('Apple')
  const second = fixture.database.createWord('  apples  ')
  assert.equal(first.entry.word, 'apple')
  assert.equal(second.duplicate, true)
  assert.equal(second.entry.id, first.entry.id)
})

test('createWord 保留专有名词大小写并与小写形式去重', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const first = fixture.database.createWord('China')
  const second = fixture.database.createWord('china')
  assert.equal(first.entry.word, 'China')
  assert.equal(second.duplicate, true)
  assert.equal(second.entry.id, first.entry.id)
})

test('存量词条迁移：规范化并合并撞键词条，幂等', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  fixture.database.close()

  // 构造旧格式数据：先 Apple（含释义），后 apples（含释义）
  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'))
  raw.prepare(`DELETE FROM settings WHERE key = '_wordNormalizationV1'`).run()
  raw.prepare(`INSERT INTO words (id, word, normalized_word, category_id, enrichment_status, created_at, updated_at)
    VALUES ('old-apple', 'Apple', 'apple', 'uncategorized', 'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run()
  raw.prepare(`INSERT INTO words (id, word, normalized_word, category_id, enrichment_status, created_at, updated_at)
    VALUES ('old-apples', 'apples', 'apples', 'uncategorized', 'pending', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`).run()
  raw.prepare(`INSERT INTO senses (id, word_id, part_of_speech, definition_zh, sort_order) VALUES ('s1', 'old-apple', 'noun', '苹果', 0)`).run()
  raw.prepare(`INSERT INTO senses (id, word_id, part_of_speech, definition_zh, sort_order) VALUES ('s2', 'old-apples', 'noun', '复数苹果', 0)`).run()
  raw.prepare(`INSERT INTO tags (id, name, created_at) VALUES ('t1', '水果', '2026-01-01T00:00:00.000Z')`).run()
  raw.prepare(`INSERT INTO word_tags (word_id, tag_id) VALUES ('old-apples', 't1')`).run()
  raw.close()

  // 重新打开触发迁移
  const migrated = new AppDatabase(fixture.directory)
  const entries = migrated.listWords({})
  assert.equal(entries.length, 1)
  assert.equal(entries[0].word, 'apple')
  assert.deepEqual(entries[0].senses.map((sense) => sense.definitionZh).sort(), ['复数苹果', '苹果'])
  assert.deepEqual(entries[0].tags.map((tag) => tag.name), ['水果'])

  // 幂等：再次打开不再变化
  migrated.close()
  const reopened = new AppDatabase(fixture.directory)
  assert.equal(reopened.listWords({}).length, 1)
  reopened.close()
})

test('listing and reading words do not change review state', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('curve')
  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'))
  raw.prepare(`UPDATE words SET last_reviewed_at = ?, next_review_at = ?, review_count = ? WHERE id = ?`)
    .run('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 4, created.entry.id)
  raw.close()

  const before = fixture.database.getWord(created.entry.id)
  fixture.database.listWords({ query: 'curve' })
  fixture.database.getWord(created.entry.id)
  const after = fixture.database.getWord(created.entry.id)
  assert.deepEqual(after, before)
})

test('记忆曲线排序：未复习最前，其次最紧迫', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const never = fixture.database.createWord('never')
  const dueSoon = fixture.database.createWord('duesoon')
  const dueLater = fixture.database.createWord('duelater')
  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'))
  const nowIso = new Date().toISOString()
  raw.prepare(`UPDATE words SET last_reviewed_at = ?, next_review_at = ? WHERE id = ?`)
    .run(nowIso, new Date(Date.now() - 86400000).toISOString(), dueSoon.entry.id)
  raw.prepare(`UPDATE words SET last_reviewed_at = ?, next_review_at = ? WHERE id = ?`)
    .run(nowIso, new Date(Date.now() + 86400000).toISOString(), dueLater.entry.id)
  raw.close()

  const ordered = fixture.database.listWords({ sort: 'due' }).map((entry) => entry.word)
  assert.deepEqual(ordered, ['never', 'duesoon', 'duelater'])
})

test('manual save completes the AI task and marks the word ready', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Vocabulary')
  const task = fixture.database.nextPendingTask()
  assert.ok(task)
  fixture.database.setTaskStatus(task.taskId, 'processing')
  fixture.database.setWordStatus(created.entry.id, 'processing')

  const saved = fixture.database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: 'vəˈkæbjələri',
    senses: [{ partOfSpeech: 'noun', definitionZh: '词汇' }],
    categoryId: created.entry.categoryId,
    tagNames: ['考试']
  })

  assert.equal(saved.status, 'ready')
  assert.equal(fixture.database.isTaskProcessing(task.taskId), false)
  assert.equal(fixture.database.nextPendingTask(), null)
  assert.deepEqual(saved.senses.map((sense) => sense.definitionZh), ['词汇'])
})

test('AI enrichment is trusted immediately and creates its suggested category', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Vocabulary')

  fixture.database.applyEnrichment(created.entry.id, {
    ipaUk: 'vəˈkæbjələri',
    senses: [{ partOfSpeech: 'noun', definitionZh: '词汇' }],
    suggestedCategory: '学术写作',
    tagNames: ['考试'],
    morphemes: [],
    formationSummary: ''
  })

  const enriched = fixture.database.getWord(created.entry.id)
  assert.equal(enriched?.status, 'ready')
  assert.equal(enriched?.categoryName, '学术写作')
  assert.deepEqual(enriched?.senses.map((sense) => sense.definitionZh), ['词汇'])
  assert.deepEqual(enriched?.tags.map((tag) => tag.name), ['考试'])
})

test('AI enrichment persists reusable morphemes and the formation summary', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Conversion')
  const morphemes = [
    { kind: 'prefix', form: 'con-', canonicalForm: 'con-', meaning: '共同、一起' },
    { kind: 'root', form: 'vers', canonicalForm: 'vert / vers', meaning: '转、转变' },
    { kind: 'suffix', form: '-ion', canonicalForm: '-ion', meaning: '动作、过程或结果' }
  ]

  fixture.database.applyEnrichment(created.entry.id, {
    ipaUk: 'kənˈvɜːʃən',
    senses: [{ partOfSpeech: 'noun', definitionZh: '转换；转化' }],
    suggestedCategory: '通用词汇',
    tagNames: ['变化'],
    morphemes,
    formationSummary: 'con-（共同）+ vers（转）+ -ion（名词后缀）→ 转换。'
  })

  const enriched = fixture.database.getWord(created.entry.id)
  assert.equal(enriched?.formationSummary, 'con-（共同）+ vers（转）+ -ion（名词后缀）→ 转换。')
  assert.deepEqual(enriched?.aiMorphemes, morphemes)
})

test('resolved morphemes preserve their kind, surface form, source, and order', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Conversion')

  fixture.database.setRootMatches(created.entry.id, [{
    root: 'vert / vers',
    surfaceForm: 'vers',
    kind: 'root',
    meaning: '转、转变',
    formationNote: '',
    source: 'dictionary',
    sourceAnchor: 'root-vers',
    sourceLabel: '词根 vert / vers',
    matchedVia: 'morpheme',
    sortOrder: 1
  }])

  assert.deepEqual(fixture.database.getWord(created.entry.id)?.rootMatches, [{
    id: fixture.database.getWord(created.entry.id)?.rootMatches[0]?.id,
    root: 'vert / vers',
    surfaceForm: 'vers',
    kind: 'root',
    meaning: '转、转变',
    formationNote: '',
    source: 'dictionary',
    sourceAnchor: 'root-vers',
    sourceLabel: '词根 vert / vers',
    matchedVia: 'morpheme',
    sortOrder: 1
  }])
})

test('legacy dictionary roots gain a usable surface form when reopened', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-morpheme-migration-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('Vocabulary')
  first.setRootMatches(created.entry.id, [{
    root: 'voc',
    surfaceForm: 'voc',
    kind: 'root',
    meaning: '声音',
    formationNote: '',
    source: 'dictionary',
    sourceAnchor: 'root-voc',
    sourceLabel: '词根 voc',
    matchedVia: 'exact',
    sortOrder: 0
  }])
  first.close()

  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw.prepare(`UPDATE root_matches SET surface_form = ''`).run()
  raw.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  assert.equal(reopened.getWord(created.entry.id)?.rootMatches[0]?.surfaceForm, 'voc')
})

test('word search includes the AI formation summary', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Conversion')
  fixture.database.applyEnrichment(created.entry.id, {
    ipaUk: 'kənˈvɜːʃən',
    senses: [{ partOfSpeech: 'noun', definitionZh: '转换；转化' }],
    suggestedCategory: null,
    tagNames: [],
    morphemes: [
      { kind: 'suffix', form: '-ion', canonicalForm: '-ion', meaning: '动作、过程或结果' }
    ],
    formationSummary: 'vers（转）+ -ion（名词后缀）→ 转换。'
  })

  assert.deepEqual(fixture.database.listWords({ query: '名词后缀' }).map((entry) => entry.word), ['conversion'])
})

test('legacy completed words are queued once for background morphology enrichment', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-morphology-backfill-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('Legacy')
  const task = first.nextPendingTask()
  assert.ok(task)
  first.applyEnrichment(created.entry.id, {
    ipaUk: 'ˈleɡəsi',
    senses: [{ partOfSpeech: 'noun', definitionZh: '遗留事物' }],
    suggestedCategory: null,
    tagNames: [],
    morphemes: [],
    formationSummary: ''
  })
  first.setTaskStatus(task.taskId, 'completed')
  first.close()

  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  const wordColumns = raw.pragma('table_info(words)') as { name: string }[]
  const taskColumns = raw.pragma('table_info(tasks)') as { name: string }[]
  if (wordColumns.some((column) => column.name === 'morphology_version')) raw.exec('ALTER TABLE words DROP COLUMN morphology_version')
  if (taskColumns.some((column) => column.name === 'priority')) raw.exec('ALTER TABLE tasks DROP COLUMN priority')
  raw.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  assert.equal(reopened.nextPendingTask()?.wordId, created.entry.id)
  assert.equal(reopened.getWord(created.entry.id)?.status, 'pending')
})

test('reanalyse all queues active words without restoring trash', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const active = fixture.database.createWord('Active')
  const second = fixture.database.createWord('Second')
  const trashed = fixture.database.createWord('Discarded')
  fixture.database.trashWord(trashed.entry.id)
  for (const wordId of [active.entry.id, second.entry.id]) {
    fixture.database.applyEnrichment(wordId, {
      ipaUk: 'test',
      senses: [{ partOfSpeech: 'noun', definitionZh: '测试' }],
      suggestedCategory: null,
      tagNames: [],
      morphemes: [],
      formationSummary: ''
    })
  }
  while (true) {
    const task = fixture.database.nextPendingTask()
    if (!task) break
    fixture.database.setTaskStatus(task.taskId, 'completed')
  }

  assert.equal(fixture.database.reanalyseAllWords(), 2)
  assert.equal(fixture.database.getQueueStatus(false).pending, 2)
  assert.equal(fixture.database.getWord(active.entry.id)?.status, 'pending')
  assert.equal(fixture.database.getWord(trashed.entry.id)?.isDeleted, true)
})

test('legacy review records become ready when the database reopens', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-review-migration-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('Trusted')
  first.close()

  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw
    .prepare(`UPDATE words SET enrichment_status = 'needs_review', ai_reviewed = 0, suggested_category = 'AI 分类' WHERE id = ?`)
    .run(created.entry.id)
  raw.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  const migrated = reopened.getWord(created.entry.id)
  assert.equal(migrated?.status, 'ready')
  assert.equal(migrated?.categoryName, 'AI 分类')
})

test('legacy Ollama settings migrate to DeepSeek defaults', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-deepseek-migration-'))
  const first = new AppDatabase(directory)
  first.close()

  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw.prepare(`UPDATE settings SET value = 'ollama' WHERE key = 'aiProvider'`).run()
  raw.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('ollamaUrl', 'http://127.0.0.1:11434')`).run()
  raw.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('ollamaModel', 'legacy-model')`).run()
  raw.prepare(`DELETE FROM settings WHERE key IN ('deepseekApiUrl', 'deepseekModel', 'deepseekApiKey')`).run()
  raw.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  assert.deepEqual(reopened.getSettings(), {
    aiProvider: 'deepseek',
    deepseekApiUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-v4-flash',
    deepseekApiKey: '',
    dictionaryPath: '',
    dailyNewLimit: 20
  })
})

test('DeepSeek API key is encoded at rest and decoded through settings', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-secret-'))
  const codec: SecretCodec = {
    encode: (value) => `encrypted:${value}`,
    decode: (value) => value.replace(/^encrypted:/, '')
  }
  const database = new AppDatabase(directory, codec)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  database.saveSettings({
    ...database.getSettings(),
    deepseekApiKey: 'sk-secret'
  })

  assert.equal(database.getSettings().deepseekApiKey, 'sk-secret')
  const raw = new Database(path.join(directory, 'shengciben.sqlite'), { readonly: true })
  const stored = raw.prepare(`SELECT value FROM settings WHERE key = 'deepseekApiKey'`).get() as { value: string }
  raw.close()
  assert.equal(stored.value, 'encrypted:sk-secret')
})

test('interrupted processing tasks return to pending when the database reopens', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-recovery-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('Resilient')
  const task = first.nextPendingTask()
  assert.ok(task)
  first.setTaskStatus(task.taskId, 'processing')
  first.setWordStatus(created.entry.id, 'processing')
  first.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  assert.equal(reopened.nextPendingTask()?.wordId, created.entry.id)
  assert.equal(reopened.getWord(created.entry.id)?.status, 'pending')
})

test('duplicate results expose whether the existing word is in trash', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Recoverable')
  fixture.database.trashWord(created.entry.id)

  const duplicate = fixture.database.createWord('recoverable')

  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.entry.id, created.entry.id)
  assert.equal(duplicate.entry.isDeleted, true)
})

test('empty trash permanently deletes only trashed words and their queued tasks', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const active = fixture.database.createWord('Active')
  const firstTrashed = fixture.database.createWord('Discarded')
  const secondTrashed = fixture.database.createWord('Removed')
  fixture.database.trashWord(firstTrashed.entry.id)
  fixture.database.trashWord(secondTrashed.entry.id)

  assert.equal(fixture.database.emptyTrash(), 2)
  assert.equal(fixture.database.getWord(firstTrashed.entry.id), null)
  assert.equal(fixture.database.getWord(secondTrashed.entry.id), null)
  assert.equal(fixture.database.getWord(active.entry.id)?.word, 'active')
  assert.equal(fixture.database.getQueueStatus(false).pending, 1)
  assert.equal(fixture.database.emptyTrash(), 0)
})

test('re-enrichment keeps existing senses and tags to protect manual edits', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Guarded')
  fixture.database.applyEnrichment(created.entry.id, {
    ipaUk: 'ˈɡɑːdɪd',
    senses: [{ partOfSpeech: 'noun', definitionZh: '有人看守的' }],
    suggestedCategory: null,
    tagNames: ['手动标签'],
    morphemes: [],
    formationSummary: ''
  })

  fixture.database.applyEnrichment(created.entry.id, {
    ipaUk: 'ˈɡɑːdid',
    senses: [{ partOfSpeech: 'adjective', definitionZh: 'AI 新释义' }],
    suggestedCategory: 'AI 分类',
    tagNames: ['AI 标签'],
    morphemes: [],
    formationSummary: '重新分析。'
  })

  const enriched = fixture.database.getWord(created.entry.id)
  assert.deepEqual(enriched?.senses.map((sense) => sense.definitionZh), ['有人看守的'])
  assert.deepEqual(enriched?.tags.map((tag) => tag.name), ['手动标签'])
  assert.equal(enriched?.ipaUk, 'ˈɡɑːdid')
  assert.equal(enriched?.formationSummary, '重新分析。')
})

test('retryable failures count up and manual retry resets the counter', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Flaky')
  const task = fixture.database.nextPendingTask()
  assert.ok(task)

  assert.equal(fixture.database.bumpTaskRetry(task.taskId), 1)
  assert.equal(fixture.database.bumpTaskRetry(task.taskId), 2)

  fixture.database.retryTask(created.entry.id)
  assert.equal(fixture.database.bumpTaskRetry(task.taskId), 1)
})
