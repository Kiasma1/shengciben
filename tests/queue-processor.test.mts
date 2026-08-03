import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AppDatabase } from '../src/main/database.ts'
import { DeepSeekApiError } from '../src/main/deepseek.ts'
import { QueueProcessor } from '../src/main/queue-processor.ts'

test('an in-flight AI response cannot overwrite a manual save', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('Manual')
  const started = Promise.withResolvers<void>()
  const response = Promise.withResolvers<{
    ipaUk: string
    senses: { partOfSpeech: string; definitionZh: string }[]
    suggestedCategory: string | null
    tagNames: string[]
    morphemes: { kind: 'prefix' | 'root' | 'suffix'; form: string; canonicalForm: string; meaning: string }[]
    formationSummary: string
  }>()
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async () => {
      started.resolve()
      return response.promise
    }
  }
  const providers = { get: () => provider }
  const processor = new QueueProcessor(database, providers, () => undefined)
  const processing = processor.processNext()
  await started.promise

  database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: 'manual-ipa',
    senses: [{ partOfSpeech: 'noun', definitionZh: '人工释义' }],
    categoryId: created.entry.categoryId,
    tagNames: ['人工']
  })
  response.resolve({
    ipaUk: 'ai-ipa',
    senses: [{ partOfSpeech: 'noun', definitionZh: 'AI 释义' }],
    suggestedCategory: null,
    tagNames: ['AI'],
    morphemes: [],
    formationSummary: ''
  })
  await processing

  const saved = database.getWord(created.entry.id)
  assert.equal(saved?.ipaUk, 'manual-ipa')
  assert.equal(saved?.senses[0]?.definitionZh, '人工释义')
  assert.deepEqual(saved?.tags.map((tag) => tag.name), ['人工'])
  assert.equal(saved?.status, 'ready')
})

test('a manual save during provider detection prevents AI from starting', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-queue-check-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('Detection')
  const checkStarted = Promise.withResolvers<void>()
  const connection = Promise.withResolvers<{ available: boolean; models: string[]; message: string }>()
  let enrichCalled = false
  const provider = {
    id: 'deepseek',
    check: async () => {
      checkStarted.resolve()
      return connection.promise
    },
    enrich: async () => {
      enrichCalled = true
      throw new Error('不应调用')
    }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined)
  const processing = processor.processNext()
  await checkStarted.promise

  database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: 'saved',
    senses: [{ partOfSpeech: 'noun', definitionZh: '人工保存' }],
    categoryId: created.entry.categoryId,
    tagNames: []
  })
  connection.resolve({ available: true, models: ['test'], message: 'ok' })
  await processing

  assert.equal(enrichCalled, false)
  assert.equal(database.getWord(created.entry.id)?.status, 'ready')
})

test('paused queue does not claim the next task', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-queue-pause-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  database.createWord('Paused')
  let checkCalled = false
  const provider = {
    id: 'deepseek',
    check: async () => {
      checkCalled = true
      return { available: true, models: ['test'], message: 'ok' }
    },
    enrich: async () => {
      throw new Error('不应调用')
    }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined)

  processor.setPaused(true)
  await processor.processNext()

  assert.equal(checkCalled, false)
  assert.deepEqual(processor.getStatus(), { pending: 1, processing: 0, failed: 0, paused: true })
})

test('retryable DeepSeek failures return the word to the pending queue', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-deepseek-retry-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('Retryable')
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['deepseek-v4-flash'], message: 'ok' }),
    enrich: async () => {
      throw new DeepSeekApiError(429, 'DeepSeek 请求过于频繁，请稍后重试。', true)
    }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined)

  await processor.processNext()

  assert.equal(database.getWord(created.entry.id)?.status, 'pending')
  assert.deepEqual(processor.getStatus(), { pending: 1, processing: 0, failed: 0, paused: false })
})

test('AI queue stores the reconciled morpheme chain with the enrichment', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-morpheme-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('Conversion')
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['deepseek-v4-flash'], message: 'ok' }),
    enrich: async () => ({
      ipaUk: 'kənˈvɜːʃən',
      senses: [{ partOfSpeech: 'noun', definitionZh: '转换；转化' }],
      suggestedCategory: null,
      tagNames: ['变化'],
      morphemes: [
        { kind: 'root' as const, form: 'vers', canonicalForm: 'vert / vers', meaning: '转、转变' }
      ],
      formationSummary: 'vers（转）+ -ion（名词后缀）→ 转换。'
    })
  }
  const processor = new QueueProcessor(
    database,
    { get: () => provider },
    () => undefined,
    async () => [{
      root: 'vert / vers',
      surfaceForm: 'vers',
      kind: 'root',
      meaning: '转、转变',
      formationNote: '',
      source: 'dictionary',
      sourceAnchor: 'root-vers',
      sourceLabel: '词根 vert / vers',
      matchedVia: 'morpheme',
      sortOrder: 0
    }]
  )

  await processor.processNext()

  const enriched = database.getWord(created.entry.id)
  assert.equal(enriched?.formationSummary, 'vers（转）+ -ion（名词后缀）→ 转换。')
  assert.equal(enriched?.rootMatches[0]?.root, 'vert / vers')
  assert.equal(enriched?.rootMatches[0]?.source, 'dictionary')
})
