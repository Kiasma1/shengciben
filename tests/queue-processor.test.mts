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

test('exhausted retryable failures mark the word failed instead of retrying forever', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-deepseek-retry-limit-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('Exhausted')
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['deepseek-v4-flash'], message: 'ok' }),
    enrich: async () => {
      throw new DeepSeekApiError(429, 'DeepSeek 请求过于频繁，请稍后重试。', true)
    }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined)

  for (let round = 0; round < 10; round += 1) await processor.processNext()

  const exhausted = database.getWord(created.entry.id)
  assert.equal(exhausted?.status, 'failed')
  assert.match(exhausted?.aiError ?? '', /重试 10 次后仍失败/)
  assert.deepEqual(processor.getStatus(), { pending: 0, processing: 0, failed: 1, paused: false })
})

test('phrase queue enrichment skips morphology and persists phrase analysis', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-phrase-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const created = database.createWord('welfare check')
  let receivedEntryType = ''
  let resolveCalled = false
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async (input: { entryType: string }) => {
      receivedEntryType = input.entryType
      return {
        entryType: 'phrase' as const,
        ipaUk: '',
        senses: [{ partOfSpeech: 'noun phrase', definitionZh: '整体释义' }],
        suggestedCategory: null,
        tagNames: [],
        morphemes: [],
        formationSummary: '',
        phraseType: 'expression',
        phraseComponents: [{ text: 'welfare', meaningZh: '安全状况' }, { text: 'check', meaningZh: '确认' }],
        phraseExplanation: '整体表达说明'
      }
    }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined, async () => {
    resolveCalled = true
    return []
  })

  await processor.processNext()

  const enriched = database.getWord(created.entry.id)
  assert.equal(receivedEntryType, 'phrase')
  assert.equal(resolveCalled, false)
  assert.equal(enriched?.phraseType, 'expression')
  assert.equal(enriched?.phraseComponents[0]?.text, 'welfare')
  assert.equal(enriched?.rootMatches.length, 0)
})

test('phrase queue reuses retry and failure handling', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-phrase-retry-'))
  const database = new AppDatabase(directory)
  context.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'deepseek' })
  const created = database.createWord('take care of')
  const provider = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async () => { throw new DeepSeekApiError(429, 'retry phrase', true) }
  }
  const processor = new QueueProcessor(database, { get: () => provider }, () => undefined)
  await processor.processNext()
  assert.equal(database.getWord(created.entry.id)?.status, 'pending')
  assert.equal(database.getQueueStatus(false).pending, 1)
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

test('local-only mode makes a Word ready without DeepSeek or IPA', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-local-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'local' })
  const created = database.createWord('elusive')
  let deepSeekCalled = false
  let rootsCalled = false
  const local = {
    id: 'local',
    check: async () => ({ available: true, models: ['Qwen3-0.6B'], message: 'local ready' }),
    enrich: async () => ({ source: 'local' as const, entryType: 'word' as const, usageNote: '常用于描述难以捕捉的事物。', ipaUk: '', senses: [{ partOfSpeech: 'adj.', definitionZh: '难以捉摸的' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: '', phraseComponents: [], phraseExplanation: '' })
  }
  const deepseek = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async () => { deepSeekCalled = true; throw new Error('不应调用') }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined, async () => { rootsCalled = true; return [] })
  await processor.processNext()
  const enriched = database.getWord(created.entry.id)
  assert.equal(enriched?.status, 'ready')
  assert.equal(enriched?.enrichmentSource, 'local')
  assert.equal(enriched?.usageNote, '常用于描述难以捕捉的事物。')
  assert.equal(enriched?.ipaUk, '')
  assert.equal(deepSeekCalled, false)
  assert.equal(rootsCalled, true)
})

test('DeepSeek-first mode uses DeepSeek before Local AI', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-deepseek-first-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'deepseek-first', deepseekApiKey: 'sk-test' })
  const created = database.createWord('elusive')
  let localChecked = false
  const local = {
    id: 'local',
    check: async () => { localChecked = true; return { available: true, models: ['Qwen3-0.6B'], message: 'local ready' } },
    enrich: async () => { throw new Error('不应调用') }
  }
  const deepseek = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async () => ({ source: 'deepseek' as const, entryType: 'word' as const, usageNote: '', ipaUk: 'ˈɪluːsɪv', senses: [{ partOfSpeech: 'adj.', definitionZh: '难以捉摸的' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: '', phraseComponents: [], phraseExplanation: '' })
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)
  await processor.processNext()
  assert.equal(localChecked, false)
  assert.equal(database.getWord(created.entry.id)?.enrichmentSource, 'deepseek')
})

test('DeepSeek-first mode falls back to Local AI when DeepSeek is unavailable', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-deepseek-first-fallback-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'deepseek-first', deepseekApiKey: 'sk-test' })
  const created = database.createWord('serendipity')
  const local = {
    id: 'local',
    check: async () => ({ available: true, models: ['Qwen3-0.6B'], message: 'local ready' }),
    enrich: async () => ({ source: 'local' as const, entryType: 'word' as const, usageNote: '本地用法', ipaUk: '', senses: [{ partOfSpeech: 'noun', definitionZh: '意外发现珍奇事物的才能' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: '', phraseComponents: [], phraseExplanation: '' })
  }
  const deepseek = {
    id: 'deepseek',
    check: async () => ({ available: false, models: [], message: 'DeepSeek 不可用' }),
    enrich: async () => { throw new Error('不应调用') }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)
  await processor.processNext()
  assert.equal(database.getWord(created.entry.id)?.enrichmentSource, 'local')
  assert.equal(database.getWord(created.entry.id)?.status, 'ready')
})

test('auto mode sends a Phrase to DeepSeek before Local AI', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-auto-queue-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'auto', deepseekApiKey: 'sk-test' })
  const created = database.createWord('welfare check')
  let localChecked = false
  const local = {
    id: 'local',
    check: async () => { localChecked = true; return { available: true, models: ['Qwen3-0.6B'], message: 'local ready' } },
    enrich: async () => { throw new Error('不应调用') }
  }
  let deepSeekCalls = 0
  const deepseek = {
    id: 'deepseek',
    check: async () => ({ available: true, models: ['test'], message: 'ok' }),
    enrich: async () => { deepSeekCalls += 1; return { source: 'deepseek' as const, entryType: 'phrase' as const, usageNote: '', ipaUk: '', senses: [{ partOfSpeech: 'noun phrase', definitionZh: '高级安危检查释义' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: 'noun phrase', phraseComponents: [{ text: 'welfare', meaningZh: '安全状况' }, { text: 'check', meaningZh: '确认' }], phraseExplanation: '完整表达的高级说明' } }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)
  await processor.processNext()
  const enriched = database.getWord(created.entry.id)
  assert.equal(deepSeekCalls, 1)
  assert.equal(localChecked, false)
  assert.equal(enriched?.status, 'ready')
  assert.equal(enriched?.enrichmentSource, 'deepseek')
  assert.equal(enriched?.senses[0]?.definitionZh, '高级安危检查释义')
  assert.equal(database.getQueueStatus(false).pending, 0)
})

test('auto mode falls back to Local AI when a Phrase cannot use DeepSeek', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-auto-phrase-fallback-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'auto' })
  const created = database.createWord('out of the blue')
  const local = {
    id: 'local',
    check: async () => ({ available: true, models: ['Qwen3-0.6B'], message: 'local ready' }),
    enrich: async () => ({ source: 'local' as const, entryType: 'phrase' as const, usageNote: '', ipaUk: '', senses: [{ partOfSpeech: 'expression', definitionZh: '突然发生的' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: 'expression', phraseComponents: [], phraseExplanation: '本地基础解析。' })
  }
  const deepseek = {
    id: 'deepseek',
    check: async () => ({ available: false, models: [], message: '未配置 DeepSeek API Key。' }),
    enrich: async () => { throw new Error('不应调用') }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)
  await processor.processNext()
  const enriched = database.getWord(created.entry.id)
  assert.equal(enriched?.status, 'ready')
  assert.equal(enriched?.enrichmentSource, 'local')
  assert.equal(enriched?.phraseExplanation, '本地基础解析。')
})

test('auto mode keeps a Word local across reanalysis and preserves manual edits', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-auto-manual-reanalysis-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'auto', deepseekApiKey: 'sk-test' })
  const created = database.createWord('elusive')
  const local = {
    id: 'local',
    check: async () => ({ available: true, models: ['Qwen3-0.6B'], message: 'local ready' }),
    enrich: async () => ({ source: 'local' as const, entryType: 'word' as const, usageNote: '本地用法', ipaUk: '', senses: [{ partOfSpeech: 'adj.', definitionZh: '本地释义' }], suggestedCategory: null, tagNames: ['本地'], morphemes: [], formationSummary: '', phraseType: '', phraseComponents: [], phraseExplanation: '' })
  }
  let deepSeekCalled = false
  const deepseek = {
    id: 'deepseek',
    check: async () => { deepSeekCalled = true; return { available: true, models: ['test'], message: 'ok' } },
    enrich: async () => { throw new Error('不应调用') }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)

  await processor.processNext()
  database.saveWord({ id: created.entry.id, word: created.entry.word, ipaUk: '人工 IPA', senses: [{ partOfSpeech: 'adj.', definitionZh: '人工释义' }], categoryId: created.entry.categoryId, tagNames: ['人工'] })
  database.reanalyseAllWords()
  await processor.processNext()

  const saved = database.getWord(created.entry.id)
  assert.equal(saved?.enrichmentSource, 'local')
  assert.equal(saved?.senses[0]?.definitionZh, '人工释义')
  assert.deepEqual(saved?.tags.map((tag) => tag.name), ['人工'])
  assert.equal(deepSeekCalled, false)
})

test('auto Phrase falls back to Local AI after DeepSeek 402 without retry', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-local-402-'))
  const database = new AppDatabase(directory)
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  database.saveSettings({ ...database.getSettings(), aiProvider: 'auto', deepseekApiKey: 'sk-test' })
  const created = database.createWord('red flag')
  const calls: string[] = []
  const local = {
    id: 'local',
    check: async () => { calls.push('local-check'); return { available: true, models: ['Qwen3-0.6B'], message: 'local ready' } },
    enrich: async () => { calls.push('local-enrich'); return { source: 'local' as const, entryType: 'phrase' as const, usageNote: '', ipaUk: '', senses: [{ partOfSpeech: 'expression', definitionZh: '危险信号' }], suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', phraseType: 'expression', phraseComponents: [], phraseExplanation: '表示警示或危险。' } }
  }
  const deepseek = {
    id: 'deepseek',
    check: async () => { calls.push('deepseek-check'); return { available: true, models: ['test'], message: 'ok' } },
    enrich: async () => { calls.push('deepseek-enrich'); throw new DeepSeekApiError(402, 'DeepSeek 账户余额不足。', false) }
  }
  const processor = new QueueProcessor(database, { get: (id: string) => id === 'local' ? local : deepseek } as never, () => undefined)
  await processor.processNext()
  assert.equal(database.getWord(created.entry.id)?.status, 'ready')
  assert.equal(database.getWord(created.entry.id)?.enrichmentSource, 'local')
  assert.equal(database.getQueueStatus(false).pending, 0)
  assert.deepEqual(calls, ['deepseek-check', 'deepseek-enrich', 'local-check', 'local-enrich'])
})
