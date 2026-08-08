import assert from 'node:assert/strict'
import test from 'node:test'
import { AiProviderRegistry } from '../src/main/ai-provider.ts'
import { checkDeepSeek, DeepSeekApiError, DeepSeekProvider, enrichWithDeepSeek } from '../src/main/deepseek.ts'

test('DeepSeek check authenticates and returns the available models', async () => {
  let requestedUrl = ''
  let authorization = ''
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input)
    authorization = new Headers(init?.headers).get('authorization') ?? ''
    return new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
        { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const status = await checkDeepSeek({
    baseUrl: 'https://api.deepseek.com/',
    apiKey: 'sk-test'
  }, fetcher)

  assert.equal(requestedUrl, 'https://api.deepseek.com/models')
  assert.equal(authorization, 'Bearer sk-test')
  assert.deepEqual(status, {
    available: true,
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    message: 'DeepSeek 已连接。'
  })
})

test('DeepSeek enrichment requests JSON output and parses the vocabulary fields', async () => {
  let requestedUrl = ''
  let requestBody: Record<string, unknown> = {}
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input)
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            ipaUk: 'kənˈvɜːʃən',
            senses: [{ partOfSpeech: 'noun', definitionZh: '转换；转化' }],
            suggestedCategory: '学术写作',
            suggestedTags: ['考试'],
            morphemes: [
              { kind: 'prefix', form: 'con-', canonicalForm: 'con-', meaning: '共同、一起' },
              { kind: 'root', form: 'vers', canonicalForm: 'vert / vers', meaning: '转、转变' },
              { kind: 'suffix', form: '-ion', canonicalForm: '-ion', meaning: '动作、过程或结果' }
            ],
            formationSummary: 'con-（共同）+ vers（转）+ -ion（名词后缀）→ 转换。'
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const enrichment = await enrichWithDeepSeek({
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-v4-flash',
    word: 'conversion',
    entryType: 'word',
    existingCategories: ['学术写作']
  }, fetcher)

  assert.equal(requestedUrl, 'https://api.deepseek.com/chat/completions')
  assert.equal(requestBody.model, 'deepseek-v4-flash')
  assert.deepEqual(requestBody.response_format, { type: 'json_object' })
  assert.equal(requestBody.stream, false)
  assert.equal(requestBody.max_tokens, 8000)
  assert.deepEqual(requestBody.thinking, { type: 'disabled' })
  assert.deepEqual(enrichment, {
    source: 'deepseek',
    entryType: 'word',
    usageNote: '',
    ipaUk: 'kənˈvɜːʃən',
    senses: [{ partOfSpeech: 'noun', definitionZh: '转换；转化' }],
    suggestedCategory: '学术写作',
    tagNames: ['考试'],
    morphemes: [
      { kind: 'prefix', form: 'con-', canonicalForm: 'con-', meaning: '共同、一起' },
      { kind: 'root', form: 'vers', canonicalForm: 'vert / vers', meaning: '转、转变' },
      { kind: 'suffix', form: '-ion', canonicalForm: '-ion', meaning: '动作、过程或结果' }
    ],
    formationSummary: 'con-（共同）+ vers（转）+ -ion（名词后缀）→ 转换。',
    phraseType: '',
    phraseComponents: [],
    phraseExplanation: ''
  })
})

test('DeepSeek phrase enrichment uses whole-expression schema and validates components', async () => {
  let requestBody: { messages?: { role?: string; content?: string }[] } = {}
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      ipaUk: 'ˈwelfeə tʃek',
      senses: [{ partOfSpeech: 'noun phrase', definitionZh: '完整短语释义' }],
      suggestedCategory: null,
      suggestedTags: ['表达'],
      phraseType: 'noun phrase',
      phraseComponents: [
        { text: 'welfare', meaningZh: '组件含义一' },
        { text: 'check', meaningZh: '组件含义二' }
      ],
      phraseExplanation: '完整表达优先的组合说明。'
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const enrichment = await enrichWithDeepSeek({
    baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'test',
    word: 'welfare check', entryType: 'phrase', existingCategories: []
  }, fetcher)

  assert.equal(enrichment.entryType, 'phrase')
  assert.equal(enrichment.phraseType, 'noun phrase')
  assert.equal(enrichment.senses.length, 1)
  assert.deepEqual(enrichment.morphemes, [])
  assert.deepEqual(enrichment.phraseComponents.map((component) => component.text), ['welfare', 'check'])
  assert.match(requestBody.messages?.[0]?.content ?? '', /完整.*表达/)
})

test('DeepSeek phrase enrichment rejects components absent from the input tokens', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    ipaUk: '',
    senses: [{ partOfSpeech: 'expression', definitionZh: '整体含义' }],
    suggestedCategory: null,
    suggestedTags: [],
    phraseType: 'expression',
    phraseComponents: [{ text: 'well', meaningZh: '好' }],
    phraseExplanation: '整体说明'
  }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(
    enrichWithDeepSeek({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'test', word: 'welfare check', entryType: 'phrase', existingCategories: [] }, fetcher),
    /无效的短语组成词/
  )
})

test('DeepSeek check explains that an API key is required without making a request', async () => {
  let called = false
  const fetcher: typeof fetch = async () => {
    called = true
    throw new Error('不应请求')
  }

  const status = await checkDeepSeek({
    baseUrl: 'https://api.deepseek.com',
    apiKey: '  '
  }, fetcher)

  assert.equal(called, false)
  assert.deepEqual(status, {
    available: false,
    models: [],
    message: '请输入 DeepSeek API Key。'
  })
})

test('DeepSeek check translates authentication failures for the settings screen', async () => {
  const status = await checkDeepSeek({
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-invalid'
  }, async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' }
  }))

  assert.deepEqual(status, {
    available: false,
    models: [],
    message: 'DeepSeek API Key 无效。'
  })
})

test('DeepSeek enrichment maps official API errors and retryability', async (context) => {
  const cases = [
    { status: 401, message: 'DeepSeek API Key 无效。', retryable: false },
    { status: 402, message: 'DeepSeek 账户余额不足。', retryable: false },
    { status: 429, message: 'DeepSeek 请求过于频繁，请稍后重试。', retryable: true },
    { status: 500, message: 'DeepSeek 服务暂时异常，请稍后重试。', retryable: true },
    { status: 503, message: 'DeepSeek 服务繁忙，请稍后重试。', retryable: true }
  ]

  for (const expected of cases) {
    await context.test(String(expected.status), async () => {
      await assert.rejects(
        enrichWithDeepSeek({
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'sk-test',
          model: 'deepseek-v4-flash',
          word: 'vocabulary',
          existingCategories: []
        }, async () => new Response('{}', { status: expected.status })),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekApiError)
          assert.equal(error.message, expected.message)
          assert.equal(error.retryable, expected.retryable)
          return true
        }
      )
    })
  }
})

test('DeepSeek 空内容：仅推理无正文时报出推理耗尽原因', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: 'length',
      message: { content: '', reasoning_content: '先分析一下这个词…' }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  await assert.rejects(
    enrichWithDeepSeek({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      word: 'conversion',
      existingCategories: []
    }, fetcher),
    /推理消耗了全部输出预算/
  )
})

test('DeepSeek 空内容：无推理字段时报没有返回内容', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  await assert.rejects(
    enrichWithDeepSeek({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      word: 'conversion',
      existingCategories: []
    }, fetcher),
    /DeepSeek 没有返回内容/
  )
})

test('AI provider registry resolves DeepSeek and checks it with stored settings', async () => {
  const provider = new DeepSeekProvider(async () => new Response(JSON.stringify({
    object: 'list',
    data: [{ id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  const registry = new AiProviderRegistry([provider])

  assert.equal(registry.get('deepseek'), provider)
  assert.deepEqual(await provider.check({
    aiProvider: 'deepseek',
    deepseekApiUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-v4-flash',
    deepseekApiKey: 'sk-test',
    dictionaryPath: '',
    dailyNewLimit: 20
  }), {
    available: true,
    models: ['deepseek-v4-flash'],
    message: 'DeepSeek 已连接。'
  })
})
