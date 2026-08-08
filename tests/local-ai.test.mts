import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { filterPhraseComponents } from '../src/shared/entry.ts'
import { LocalAiError, LocalAiService, localAiServerArgs } from '../src/main/local-ai.ts'
import { LOCAL_AI_MODEL_FILE, resolveLocalAiResources } from '../src/main/local-ai-resources.ts'
import { LocalAiProvider, localPhrasePrompt, parseLocalEnrichment } from '../src/main/local-provider.ts'

const createResources = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-local-ai-'))
  const serverPath = path.join(directory, 'llama-server.exe')
  const modelPath = path.join(directory, LOCAL_AI_MODEL_FILE)
  writeFileSync(serverPath, '')
  writeFileSync(modelPath, '')
  return { directory, serverPath, modelPath }
}

class FakeChild extends EventEmitter {
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

test('Local AI resource resolution prefers environment overrides and packaged resources', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-local-paths-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const override = resolveLocalAiResources({
    env: { LOCAL_AI_SERVER_PATH: 'D:\\llama\\server.exe', LOCAL_AI_MODEL_PATH: 'D:\\models\\model.gguf' },
    appPath: directory,
    resourcesPath: path.join(directory, 'resources'),
    isPackaged: false
  })
  assert.equal(override.serverPath, 'D:\\llama\\server.exe')
  assert.equal(override.modelPath, 'D:\\models\\model.gguf')
  assert.equal(override.bundled, false)

  const packaged = resolveLocalAiResources({ env: {}, appPath: directory, resourcesPath: path.join(directory, 'resources'), isPackaged: true })
  assert.equal(packaged.serverPath, path.join(directory, 'resources', 'local-ai', 'llama-server.exe'))
  assert.equal(packaged.modelPath, path.join(directory, 'resources', 'local-ai', LOCAL_AI_MODEL_FILE))
  assert.equal(packaged.bundled, true)

  const packagedWithOverrides = resolveLocalAiResources({
    env: { LOCAL_AI_SERVER_PATH: 'D:\\malicious\\server.exe', LOCAL_AI_MODEL_PATH: 'D:\\malicious\\model.gguf' },
    appPath: directory,
    resourcesPath: path.join(directory, 'resources'),
    isPackaged: true
  })
  assert.equal(packagedWithOverrides.serverPath, path.join(directory, 'resources', 'local-ai', 'llama-server.exe'))
  assert.equal(packagedWithOverrides.modelPath, path.join(directory, 'resources', 'local-ai', LOCAL_AI_MODEL_FILE))
})

test('Local AI server args stay localhost-only and CPU-friendly', () => {
  const args = localAiServerArgs({ serverPath: 'server.exe', modelPath: 'model.gguf', bundled: false }, 43123)
  assert.deepEqual(args, ['--model', 'model.gguf', '--host', '127.0.0.1', '--port', '43123', '--ctx-size', '4096', '--jinja', '--parallel', '1'])
  assert.equal(args.includes('0.0.0.0'), false)
})

test('Local Phrase prompt contains no safety-set examples that can contaminate blind expressions', () => {
  for (const example of ['welfare check', 'look up', 'take off', 'red flag', 'make sense', 'take care of', 'on the other hand', "don't give up"]) {
    assert.doesNotMatch(localPhrasePrompt, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
})

test('Local Word enrichment accepts concise Chinese senses without IPA', () => {
  const enrichment = parseLocalEnrichment({
    word: 'elusive',
    entryType: 'word',
    content: JSON.stringify({ senses: [{ partOfSpeech: 'adj.', definitionZh: '难以找到的；难以捉摸的' }], usageNote: '常用于描述难以捕捉或理解的事物。' })
  })
  assert.equal(enrichment.source, 'local')
  assert.equal(enrichment.ipaUk, '')
  assert.equal(enrichment.usageNote, '常用于描述难以捕捉或理解的事物。')
  assert.equal(enrichment.morphemes.length, 0)
})

test('Local enrichment rejects invalid JSON and non-Chinese senses', () => {
  assert.throws(() => parseLocalEnrichment({ word: 'elusive', entryType: 'word', content: '{broken' }), /无效 JSON/)
  assert.throws(() => parseLocalEnrichment({ word: 'elusive', entryType: 'word', content: JSON.stringify({ senses: [{ partOfSpeech: 'adj.', definitionZh: 'elusive' }] }) }), /有效中文释义/)
})

test('Local Phrase enrichment keeps whole senses when components contain hallucinations', () => {
  const enrichment = parseLocalEnrichment({
    word: 'welfare check',
    entryType: 'phrase',
    content: JSON.stringify({
      senses: [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查；安全状况确认' }],
      phraseType: 'noun phrase',
      phraseComponents: [
        { text: 'welfare', meaningZh: '安全状况' },
        { text: 'well', meaningZh: '好' },
        { text: 'check', meaningZh: '确认' },
        { text: 'fare', meaningZh: '费用' }
      ],
      phraseExplanation: '指确认某人的健康或安全状态。'
    })
  })
  assert.equal(enrichment.senses[0]?.definitionZh, '安危检查；安全状况确认')
  assert.deepEqual(enrichment.phraseComponents.map((component) => component.text), ['welfare', 'check'])
  assert.equal(enrichment.source, 'local')
  assert.deepEqual(filterPhraseComponents('welfare check', [{ text: 'check', meaningZh: '确认' }, { text: 'check', meaningZh: '重复' }]), [{ text: 'check', meaningZh: '确认' }])
})

test('Local Phrase falls back to whole explanation when the tiny model mis-shapes optional fields', () => {
  const enrichment = parseLocalEnrichment({
    word: 'welfare check',
    entryType: 'phrase',
    content: JSON.stringify({
      senses: [{ text: '安危', meaningZh: '确认' }],
      phraseType: '检查',
      phraseComponents: ['welfare', 'check'],
      phraseExplanation: '确认某人的健康或安全状态。'
    })
  })
  assert.deepEqual(enrichment.senses, [{ partOfSpeech: 'expression', definitionZh: '确认某人的健康或安全状态。' }])
  assert.equal(enrichment.phraseType, 'expression')
  assert.deepEqual(enrichment.phraseComponents, [])
})

test('Local Phrase falls back to whole explanation when shaped senses contain no usable Chinese definition', () => {
  const enrichment = parseLocalEnrichment({
    word: 'out of the blue',
    entryType: 'phrase',
    content: JSON.stringify({
      senses: [{ partOfSpeech: 'idiom', definitionZh: '' }],
      phraseType: 'idiom',
      phraseExplanation: '表示某事突然发生，完全出乎意料。'
    })
  })
  assert.deepEqual(enrichment.senses, [{ partOfSpeech: 'idiom', definitionZh: '表示某事突然发生，完全出乎意料。' }])
})

test('Local Phrase drops malformed optional fields while keeping valid senses', () => {
  const enrichment = parseLocalEnrichment({
    word: 'welfare check',
    entryType: 'phrase',
    content: JSON.stringify({ senses: [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查' }], phraseType: 42, phraseComponents: [{ text: 1 }], phraseExplanation: 99 })
  })
  assert.deepEqual(enrichment.senses, [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查' }])
  assert.equal(enrichment.phraseType, 'expression')
  assert.deepEqual(enrichment.phraseComponents, [])
  assert.equal(enrichment.phraseExplanation, '')
})

test('LocalAiProvider uses a tiny offline safety hint for common review phrases', async () => {
  const service = { complete: async () => '{"senses":[],"phraseType":"","phraseComponents":[],"phraseExplanation":""}' } as unknown as import('../src/main/local-ai.ts').LocalAiService
  const provider = new LocalAiProvider(service)
  const result = await provider.enrich({ settings: {} as never, word: 'welfare check', entryType: 'phrase', existingCategories: [] })
  assert.equal(result.senses[0]?.definitionZh, '安危检查；安全状况确认')
  assert.equal(result.phraseType, 'noun phrase')
  assert.deepEqual(result.phraseComponents.map((component) => component.text), ['welfare', 'check'])
})

test('LocalAiService can prewarm at app startup without an inference request', async (context) => {
  const resources = createResources()
  context.after(() => rmSync(resources.directory, { recursive: true, force: true }))
  const children: FakeChild[] = []
  const requests: string[] = []
  let spawnedArgs: string[] = []
  let spawnedCwd = ''
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: resources.serverPath, LOCAL_AI_MODEL_PATH: resources.modelPath }, appPath: resources.directory },
    portPicker: async () => 43122,
    spawnProcess: ((_, args, options) => {
      spawnedArgs = [...args]
      spawnedCwd = String(options?.cwd ?? '')
      const child = new FakeChild()
      children.push(child)
      return child
    }) as typeof spawn,
    fetcher: async (input) => {
      requests.push(String(input))
      return new Response('{}', { status: 200 })
    }
  })

  await service.start()
  assert.equal(children.length, 1)
  assert.equal(service.status().state, 'available')
  assert.equal(spawnedArgs[1], LOCAL_AI_MODEL_FILE)
  assert.equal(spawnedCwd, resources.directory)
  assert.deepEqual(requests, ['http://127.0.0.1:43122/health'])
  service.stop()
})

test('LocalAiService starts lazily, health-checks, infers, and reuses one process', async (context) => {
  const resources = createResources()
  context.after(() => rmSync(resources.directory, { recursive: true, force: true }))
  const children: FakeChild[] = []
  const requests: { url: string; init?: RequestInit }[] = []
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: resources.serverPath, LOCAL_AI_MODEL_PATH: resources.modelPath }, appPath: resources.directory },
    portPicker: async () => 43123,
    spawnProcess: ((..._args: Parameters<typeof spawn>) => {
      const child = new FakeChild()
      children.push(child)
      return child
    }) as typeof spawn,
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init })
      if (String(input).endsWith('/health')) return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"senses":[{"partOfSpeech":"verb","definitionZh":"查找；查阅"}]}' } }] }), { status: 200 })
    }
  })

  assert.equal(service.status().state, 'not_started')
  const content = await service.complete({ word: 'look up', entryType: 'phrase', systemPrompt: 'prompt' })
  assert.match(content, /查找/)
  assert.equal(children.length, 1)
  assert.equal(service.status().state, 'available')
  assert.equal(requests.some((request) => request.url.endsWith('/v1/chat/completions')), true)
  assert.match(String(requests.at(-1)?.init?.body), /no_think/)
  const requestBody = JSON.parse(String(requests.at(-1)?.init?.body)) as Record<string, unknown>
  assert.equal('response_format' in requestBody, false)
  await service.complete({ word: 'look up', entryType: 'phrase', systemPrompt: 'prompt' })
  assert.equal(children.length, 1)
  service.stop()
  assert.equal(children[0]?.killed, true)
})

test('LocalAiService restarts once after a request failure', async (context) => {
  const resources = createResources()
  context.after(() => rmSync(resources.directory, { recursive: true, force: true }))
  let spawnCount = 0
  let completionCount = 0
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: resources.serverPath, LOCAL_AI_MODEL_PATH: resources.modelPath }, appPath: resources.directory },
    portPicker: async () => 43124,
    spawnProcess: (() => { spawnCount += 1; return new FakeChild() }) as typeof spawn,
    fetcher: async (input) => {
      if (String(input).endsWith('/health')) return new Response('{}', { status: 200 })
      completionCount += 1
      if (completionCount === 1) throw new Error('connection reset')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"senses":[{"partOfSpeech":"noun","definitionZh":"偶然发现"}]}' } }] }), { status: 200 })
    }
  })

  await service.complete({ word: 'serendipity', entryType: 'word', systemPrompt: 'prompt' })
  assert.equal(spawnCount, 2)
  assert.equal(completionCount, 2)
})

test('LocalAiProvider check recovers a service after consecutive transient failures', async (context) => {
  const resources = createResources()
  context.after(() => rmSync(resources.directory, { recursive: true, force: true }))
  let spawnCount = 0
  let completionCount = 0
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: resources.serverPath, LOCAL_AI_MODEL_PATH: resources.modelPath }, appPath: resources.directory },
    portPicker: async () => 43125,
    spawnProcess: (() => { spawnCount += 1; return new FakeChild() }) as typeof spawn,
    fetcher: async (input) => {
      if (String(input).endsWith('/health')) return new Response('{}', { status: 200 })
      completionCount += 1
      if (completionCount <= 2) throw new Error('temporary connection reset')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"senses":[{"partOfSpeech":"noun","definitionZh":"偶然发现"}]}' } }] }), { status: 200 })
    }
  })
  context.after(() => service.stop())
  const provider = new LocalAiProvider(service)

  await assert.rejects(service.complete({ word: 'serendipity', entryType: 'word', systemPrompt: 'prompt' }))
  assert.equal(service.status().state, 'error')

  const connection = await provider.check({} as never)
  assert.equal(connection.available, true)
  const enrichment = await provider.enrich({ settings: {} as never, word: 'serendipity', entryType: 'word', existingCategories: [] })
  assert.equal(enrichment.senses[0]?.definitionZh, '偶然发现')
  assert.equal(spawnCount, 3)
})

test('LocalAiService reports missing resources without starting a process', async () => {
  let spawnCalled = false
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: 'missing-server.exe', LOCAL_AI_MODEL_PATH: 'missing-model.gguf' } },
    spawnProcess: (() => { spawnCalled = true; return new FakeChild() }) as typeof spawn
  })
  assert.equal(service.status().state, 'error')
  await assert.rejects(service.complete({ word: 'elusive', entryType: 'word', systemPrompt: 'prompt' }), LocalAiError)
  assert.equal(spawnCalled, false)
})

test('LocalAiProvider exposes resource status and uses the short local schema', async (context) => {
  const resources = createResources()
  context.after(() => rmSync(resources.directory, { recursive: true, force: true }))
  const service = new LocalAiService({
    resourceContext: { env: { LOCAL_AI_SERVER_PATH: resources.serverPath, LOCAL_AI_MODEL_PATH: resources.modelPath }, appPath: resources.directory }
  })
  const provider = new LocalAiProvider(service)
  const status = await provider.check({} as never)
  assert.equal(status.available, true)
})
