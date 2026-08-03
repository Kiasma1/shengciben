import { z } from 'zod'
import type { AiEnrichment, AppSettings, DeepSeekStatus } from '../shared/types'
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
const enrichmentSchema = z.object({
  ipaUk: z.string().min(1).max(80),
  senses: z.array(z.object({ partOfSpeech: z.string().min(1).max(40), definitionZh: z.string().min(1).max(160) })).min(1).max(6),
  suggestedCategory: z.string().max(60).nullable(),
  suggestedTags: z.array(z.string().min(1).max(30)).max(6)
})

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
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是英语词汇助理。只返回 JSON，不要 markdown。JSON 格式示例：{"ipaUk":"...","senses":[{"partOfSpeech":"noun","definitionZh":"..."}],"suggestedCategory":"...","suggestedTags":["..."]}。IPA 必须使用英式发音；词性用简洁英文；中文释义简洁准确。分类优先从 existingCategories 选择；没有合适项可给出一个短的新分类名。不要给出词根、例句或额外解释。'
        },
        {
          role: 'user',
          content: JSON.stringify({ word: input.word, existingCategories: input.existingCategories })
        }
      ]
    })
  })
  if (!response.ok) throw apiError(response.status)
  const payload = (await response.json()) as { choices?: { message?: { content?: string | null } }[] }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 没有返回内容。')
  const parsed = enrichmentSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new Error('DeepSeek 返回的字段不完整。')
  return {
    ipaUk: parsed.data.ipaUk,
    senses: parsed.data.senses,
    suggestedCategory: parsed.data.suggestedCategory?.trim() || null,
    tagNames: parsed.data.suggestedTags.map((tag) => tag.trim()).filter(Boolean)
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
      existingCategories: input.existingCategories
    }, this.fetcher)
  }
}
