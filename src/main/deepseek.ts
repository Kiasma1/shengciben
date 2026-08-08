import { z } from 'zod'
import type { AiEnrichment, AppSettings, DeepSeekStatus, EntryType } from '../shared/types'
import { validatePhraseComponents } from '../shared/entry.ts'
import type { AiProvider } from './ai-provider'

export class DeepSeekApiError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(status: number, message: string, retryable: boolean) {
    super(message)
    this.name = 'DeepSeekApiError'
    this.status = status
    this.retryable = retryable
  }
}

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/$/, '')}${path}`
const apiError = (status: number): DeepSeekApiError => {
  if (status === 401) return new DeepSeekApiError(status, 'DeepSeek API Key 无效。', false)
  if (status === 402) return new DeepSeekApiError(status, 'DeepSeek 账户余额不足。', false)
  if (status === 429) return new DeepSeekApiError(status, 'DeepSeek 请求过于频繁，请稍后重试。', true)
  if (status === 500) return new DeepSeekApiError(status, 'DeepSeek 服务暂时异常，请稍后重试。', true)
  if (status === 503) return new DeepSeekApiError(status, 'DeepSeek 服务繁忙，请稍后重试。', true)
  return new DeepSeekApiError(status, `DeepSeek 请求失败（${status}）。`, false)
}
const commonEnrichmentShape = {
  ipaUk: z.string().max(80),
  senses: z.array(z.object({ partOfSpeech: z.string().min(1).max(40), definitionZh: z.string().min(1).max(160) })).min(1).max(6),
  suggestedCategory: z.string().max(60).nullable(),
  suggestedTags: z.array(z.string().min(1).max(30)).max(6)
}
const wordEnrichmentSchema = z.object({
  ...commonEnrichmentShape,
  ipaUk: z.string().min(1).max(80),
  morphemes: z.array(z.object({
    kind: z.enum(['prefix', 'root', 'suffix']),
    form: z.string().min(1).max(40),
    canonicalForm: z.string().min(1).max(80),
    meaning: z.string().min(1).max(160)
  })).max(8),
  formationSummary: z.string().max(400)
})
const phraseEnrichmentSchema = z.object({
  ...commonEnrichmentShape,
  phraseType: z.string().max(60),
  phraseComponents: z.array(z.object({
    text: z.string().min(1).max(80),
    meaningZh: z.string().min(1).max(160)
  })).min(1).max(8),
  phraseExplanation: z.string().min(1).max(600)
})

const wordSystemPrompt = '你是严谨的英语词汇与词源助理。只返回 JSON，不要 markdown。JSON 格式示例：{"ipaUk":"kənˈvɜːʃən","senses":[{"partOfSpeech":"noun","definitionZh":"转换；转化"}],"suggestedCategory":"通用词汇","suggestedTags":["变化"],"morphemes":[{"kind":"prefix","form":"con-","canonicalForm":"con-","meaning":"共同、一起"},{"kind":"root","form":"vers","canonicalForm":"vert / vers","meaning":"转、转变"},{"kind":"suffix","form":"-ion","canonicalForm":"-ion","meaning":"动作、过程或结果"}],"formationSummary":"con-（共同）+ vers（转）+ -ion（名词后缀）→ 转换。"}。IPA 必须使用英式发音；词性用简洁英文；中文释义简洁准确。分类优先从 existingCategories 选择。morphemes 按单词中的顺序返回 prefix、root、suffix，只给出有语言学依据的构词成分；不要把复数、过去式等屈折变化当作构词成分，不要因字母相似强行拆分。硬性要求：每个构词成分的 form（或 canonicalForm 中的任一形式）必须逐字母连续出现在该单词中；仅含义相关但未出现在单词里的词根（如同义根 homo-、iso-、taut-、idem-）一律不得列为构词成分。无法可靠拆分时必须返回空 morphemes，formationSummary 可为空。canonicalForm 使用规范词根或词缀形式，form 使用该单词中的表面形式。'
const phraseSystemPrompt = '你是严谨的英语表达与词汇助理。当前输入是一个完整的多词英语表达，只返回 JSON，不要 markdown。必须先解释整个表达的实际含义，不要把各组成词的中文含义机械拼接；短语级含义是权威结果，组成词解释只是辅助。识别合适的短语类型，例如 phrasal verb、idiom、collocation、noun phrase、expression；如果有多个常用整体义，请在 senses 中分别返回。请输出英式完整短语 IPA（不可靠时可为空）、整体中文释义、phraseType、phraseComponents 和 phraseExplanation。每个 phraseComponent.text 必须逐字对应输入短语按空格切分后的实际 token，不能拆成 well、fare 这样的词素，也不能返回输入中不存在的 token。JSON 示例：{"ipaUk":"ˈwelfeə tʃek","senses":[{"partOfSpeech":"noun phrase","definitionZh":"安危检查；安全状况确认"}],"suggestedCategory":"生活表达","suggestedTags":["正式"],"phraseType":"noun phrase","phraseComponents":[{"text":"welfare","meaningZh":"健康、福祉或安全状况"},{"text":"check","meaningZh":"检查、确认"}],"phraseExplanation":"这里的 welfare 指某人的整体安全和健康状态，check 指进行确认，因此整个表达表示确认某人是否安全。"}。分类优先从 existingCategories 选择。'


export async function checkDeepSeek(
  input: { baseUrl: string; apiKey: string },
  fetcher: typeof fetch = fetch
): Promise<DeepSeekStatus> {
  if (!input.apiKey.trim()) {
    return { available: false, models: [], message: '请输入 DeepSeek API Key。' }
  }
  const response = await fetcher(endpoint(input.baseUrl, '/models'), {
    headers: { authorization: `Bearer ${input.apiKey}` },
    signal: AbortSignal.timeout(10000)
  })
  if (!response.ok) {
    return { available: false, models: [], message: apiError(response.status).message }
  }
  const payload = (await response.json()) as { data?: { id?: string }[] }
  const models = payload.data?.map((model) => model.id).filter((id): id is string => Boolean(id)) ?? []
  return { available: true, models, message: 'DeepSeek 已连接。' }
}

export async function enrichWithDeepSeek(
  input: {
    baseUrl: string
    apiKey: string
    model: string
    word: string
    entryType: EntryType
    existingCategories: string[]
  },
  fetcher: typeof fetch = fetch
): Promise<AiEnrichment> {
  const response = await fetcher(endpoint(input.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: input.model,
      stream: false,
      // V4 思考型模型（deepseek-v4-flash 默认开启 thinking）的推理 token 计入 max_tokens；
      // 预算不足时最终 content 会返回空，1200 常被思考链耗尽，故放宽到 8000
      max_tokens: 8000,
      // 词条富集是结构化 JSON 任务，无需深度推理：关闭思考模式更快、更便宜、且 content 不再为空
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: input.entryType === 'phrase' ? phraseSystemPrompt : wordSystemPrompt
        },
        {
          role: 'user',
          content: JSON.stringify({ entryType: input.entryType, entry: input.word, existingCategories: input.existingCategories })
        }
      ]
    })
  })
  if (!response.ok) throw apiError(response.status)
  const payload = (await response.json()) as { choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[] }
  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    const reasoning = payload.choices?.[0]?.message?.reasoning_content
    throw new Error(reasoning ? 'DeepSeek 推理消耗了全部输出预算，没有返回内容，请重试。' : 'DeepSeek 没有返回内容。')
  }
  if (input.entryType === 'phrase') {
    const parsed = phraseEnrichmentSchema.safeParse(JSON.parse(content))
    if (!parsed.success) throw new Error('DeepSeek 返回的短语字段不完整。')
    return {
      entryType: 'phrase',
      ipaUk: parsed.data.ipaUk.trim(),
      senses: parsed.data.senses,
      suggestedCategory: parsed.data.suggestedCategory?.trim() || null,
      tagNames: parsed.data.suggestedTags.map((tag) => tag.trim()).filter(Boolean),
      morphemes: [],
      formationSummary: '',
      phraseType: parsed.data.phraseType.trim(),
      phraseComponents: validatePhraseComponents(input.word, parsed.data.phraseComponents),
      phraseExplanation: parsed.data.phraseExplanation.trim()
    }
  }
  const parsed = wordEnrichmentSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new Error('DeepSeek 返回的字段不完整。')
  return {
    entryType: 'word',
    ipaUk: parsed.data.ipaUk,
    senses: parsed.data.senses,
    suggestedCategory: parsed.data.suggestedCategory?.trim() || null,
    tagNames: parsed.data.suggestedTags.map((tag) => tag.trim()).filter(Boolean),
    morphemes: parsed.data.morphemes.map((morpheme) => ({
      kind: morpheme.kind,
      form: morpheme.form.trim(),
      canonicalForm: morpheme.canonicalForm.trim(),
      meaning: morpheme.meaning.trim()
    })),
    formationSummary: parsed.data.formationSummary.trim(),
    phraseType: '',
    phraseComponents: [],
    phraseExplanation: ''
  }
}

export class DeepSeekProvider implements AiProvider {
  readonly id = 'deepseek'
  private readonly fetcher: typeof fetch

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
  }

  check(settings: AppSettings): Promise<DeepSeekStatus> {
    return checkDeepSeek({
      baseUrl: settings.deepseekApiUrl,
      apiKey: settings.deepseekApiKey
    }, this.fetcher)
  }

  enrich(
    input: {
      settings: AppSettings
      word: string
      entryType: EntryType
      existingCategories: string[]
    },
    status: DeepSeekStatus
  ): Promise<AiEnrichment> {
    const model = input.settings.deepseekModel || status.models[0]
    if (!status.available || !model) throw new Error('DeepSeek 当前不可用或没有可用模型。')
    return enrichWithDeepSeek({
      baseUrl: input.settings.deepseekApiUrl,
      apiKey: input.settings.deepseekApiKey,
      model,
      word: input.word,
      entryType: input.entryType,
      existingCategories: input.existingCategories
    }, this.fetcher)
  }
}
