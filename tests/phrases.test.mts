import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AppDatabase } from '../src/main/database.ts'
import { COMMON_FUNCTION_WORDS } from '../src/shared/entry.ts'

const createDatabase = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-phrase-'))
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

const phraseEnrichment = {
  entryType: 'phrase' as const,
  ipaUk: 'ˈwelfeə tʃek',
  senses: [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查；安全状况确认' }],
  suggestedCategory: null,
  tagNames: ['生活表达'],
  morphemes: [],
  formationSummary: '',
  phraseType: 'noun phrase',
  phraseComponents: [
    { text: 'welfare', meaningZh: '健康、福祉或安全状况' },
    { text: 'check', meaningZh: '检查、确认' }
  ],
  phraseExplanation: '这里的 welfare 指某人的整体安全和健康状态，check 表示检查、确认。'
}

const saveReady = (database: AppDatabase, raw: string) => {
  const created = database.createWord(raw)
  return database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: '',
    senses: [{ partOfSpeech: created.entry.entryType === 'phrase' ? 'phrase' : 'noun', definitionZh: '测试释义' }],
    categoryId: created.entry.categoryId,
    tagNames: []
  })
}

test('word and phrase are independent entries while phrase duplicates normalize whitespace and case', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const word = fixture.database.createWord('welfare')
  const phrase = fixture.database.createWord('  Welfare   Check  ')
  const duplicate = fixture.database.createWord('welfare check')
  const hyphenated = fixture.database.createWord('mother-in-law')

  assert.equal(word.entry.entryType, 'word')
  assert.equal(phrase.entry.entryType, 'phrase')
  assert.equal(phrase.entry.word, 'Welfare Check')
  assert.equal(phrase.entry.normalizedWord, 'welfare check')
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.entry.id, phrase.entry.id)
  assert.equal(hyphenated.entry.entryType, 'word')
  assert.equal(fixture.database.listWords().length, 3)
})

test('createWord rejects invalid phrase inputs', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  assert.throws(() => fixture.database.createWord('one two three four five six seven eight nine'), /最多 8 个词/)
  assert.throws(() => fixture.database.createWord('中文输入'), /只允许/)
  assert.throws(() => fixture.database.createWord('look up!'), /只允许/)
})

test('phrase enrichment persists whole-expression analysis and search fields', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const phrase = fixture.database.createWord('welfare check')
  fixture.database.applyEnrichment(phrase.entry.id, phraseEnrichment)

  const saved = fixture.database.getWord(phrase.entry.id)
  assert.equal(saved?.entryType, 'phrase')
  assert.equal(saved?.phraseType, 'noun phrase')
  assert.deepEqual(saved?.phraseComponents, phraseEnrichment.phraseComponents)
  assert.equal(saved?.phraseExplanation, phraseEnrichment.phraseExplanation)
  assert.equal(saved?.rootMatches.length, 0)
  assert.deepEqual(fixture.database.listWords({ query: 'welfare' }).map((entry) => entry.word), ['welfare check'])
  assert.deepEqual(fixture.database.listWords({ query: '安危' }).map((entry) => entry.word), ['welfare check'])
  assert.deepEqual(fixture.database.listWords({ query: '整体安全' }).map((entry) => entry.word), ['welfare check'])
  assert.deepEqual(fixture.database.listWords({ query: 'noun phrase' }).map((entry) => entry.word), ['welfare check'])
})

test('phrase components resolve existing words and remain unlinked until explicitly collected', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const phrase = fixture.database.createWord('welfare check')
  fixture.database.applyEnrichment(phrase.entry.id, phraseEnrichment)

  assert.equal(fixture.database.getWordByNormalized('welfare'), null)
  assert.equal(fixture.database.listWords().length, 1)
  const welfare = fixture.database.createWord('welfare')
  assert.equal(fixture.database.getWordByNormalized('WELFARE')?.id, welfare.entry.id)
  assert.equal(fixture.database.getWordByNormalized('check'), null)
  assert.equal(COMMON_FUNCTION_WORDS.has('of'), true)
})

test('editing a phrase keeps manual fields but requeues changed phrase analysis', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const phrase = fixture.database.createWord('welfare check')
  fixture.database.applyEnrichment(phrase.entry.id, phraseEnrichment)
  const changed = fixture.database.saveWord({
    id: phrase.entry.id,
    word: 'take care of',
    ipaUk: 'manual ipa',
    senses: [{ partOfSpeech: 'expression', definitionZh: '人工整体释义' }],
    categoryId: phrase.entry.categoryId,
    tagNames: ['人工']
  })
  assert.equal(changed.entryType, 'phrase')
  assert.equal(changed.status, 'pending')
  assert.equal(changed.phraseExplanation, '')
  assert.equal(changed.ipaUk, 'manual ipa')
  assert.equal(fixture.database.nextPendingTask()?.wordId, phrase.entry.id)
})

test('phrase components reject tokens that are not present in the phrase', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const phrase = fixture.database.createWord('welfare check')
  assert.throws(() => fixture.database.applyEnrichment(phrase.entry.id, {
    ...phraseEnrichment,
    phraseComponents: [{ text: 'well', meaningZh: '好' }, { text: 'fare', meaningZh: '进展' }]
  }), /无效的短语组成词/)
})

test('v2.1 words migrate to entry_type word without losing review or roots and migration is idempotent', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-phrase-migration-'))
  const first = new AppDatabase(directory)
  const word = saveReady(first, 'legacy')
  first.setRootMatches(word.id, [{
    root: 'leg', surfaceForm: 'leg', kind: 'root', meaning: '法律', formationNote: '', source: 'ai', sourceAnchor: '', sourceLabel: 'AI 解析', matchedVia: 'ai', sortOrder: 0
  }])
  first.gradeReview(word.id, 'good')
  first.close()

  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw.exec('ALTER TABLE words DROP COLUMN phrase_explanation; ALTER TABLE words DROP COLUMN phrase_components_json; ALTER TABLE words DROP COLUMN phrase_type; ALTER TABLE words DROP COLUMN entry_type;')
  raw.close()

  const migrated = new AppDatabase(directory)
  const restored = migrated.getWord(word.id)
  assert.equal(restored?.entryType, 'word')
  assert.equal(restored?.reviewCount, 1)
  assert.equal(restored?.rootMatches[0]?.root, 'leg')
  migrated.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })
  assert.equal(reopened.getWord(word.id)?.entryType, 'word')
})

test('phrase uses the existing review queue, grading algorithm, events, and delete cascades', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const word = saveReady(fixture.database, 'welfare')
  const phrase = fixture.database.createWord('welfare check')
  fixture.database.applyEnrichment(phrase.entry.id, phraseEnrichment)

  const queue = fixture.database.getReviewQueue()
  assert.deepEqual(new Set(queue.items.map((item) => item.entry.entryType)), new Set(['word', 'phrase']))
  assert.equal(queue.items.find((item) => item.entry.id === phrase.entry.id)?.intervals.good, 2 * 24 * 60)
  const graded = fixture.database.gradeReview(phrase.entry.id, 'good')
  assert.equal(graded.entry.entryType, 'phrase')
  assert.equal(graded.intervalMinutes, 2 * 24 * 60)

  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'), { readonly: true })
  assert.equal((raw.prepare('SELECT count(*) AS count FROM review_events WHERE word_id = ?').get(phrase.entry.id) as { count: number }).count, 1)
  raw.close()
  fixture.database.trashWord(phrase.entry.id)
  fixture.database.emptyTrash()
  assert.equal(fixture.database.getWord(phrase.entry.id), null)
  assert.ok(fixture.database.getWord(word.id))
})

test('JSON snapshot and SQLite backup retain phrase fields', async (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const phrase = fixture.database.createWord('welfare check')
  fixture.database.applyEnrichment(phrase.entry.id, phraseEnrichment)
  const exported = fixture.database.exportSnapshot().words[0]
  assert.equal(exported.entryType, 'phrase')
  assert.equal(exported.phraseComponents[0]?.text, 'welfare')

  const backupPath = path.join(fixture.directory, 'phrase-backup.sqlite')
  await fixture.database.backup(backupPath)
  const backup = new Database(backupPath, { readonly: true })
  const row = backup.prepare('SELECT entry_type AS entryType, phrase_type AS phraseType FROM words WHERE id = ?').get(phrase.entry.id) as { entryType: string; phraseType: string }
  assert.deepEqual(row, { entryType: 'phrase', phraseType: 'noun phrase' })
  backup.close()
})
