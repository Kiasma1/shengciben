import { z } from 'zod'
import type { OllamaStatus, WordSense } from '../shared/types'

const enrichmentSchema = z.object({
  ipaUk: z.string().min(1).max(80),
  senses: z.array(z.object({ partOfSpeech: z.string().min(1).max(40), definitionZh: z.string().min(1).max(160) })).min(1).max(6),
  suggestedCategory: z.string().max(60).nullable(),
  suggestedTags: z.array(z.string().min(1).max(30)).max(6)
})

export type AiEnrichment = {
  ipaUk: string
  senses: WordSense[]
  suggestedCategory: string | null
  tagNames: string[]
}

const endpoint = (url: string, path: string): string => `${url.replace(/\/$/, '')}${path}`

export async function checkOllama(url: string): Promise<OllamaStatus> {
  try {
    const response = await fetch(endpoint(url, '/api/tags'), { signal: AbortSignal.timeout(3500) })
    if (!response.ok) throw new Error(`服务返回 ${response.status}`)
    const payload = (await response.json()) as { models?: { name?: string }[] }
    const models = payload.models?.map((model) => model.name).filter((name): name is string => Boolean(name)) ?? []
    return { available: true, models, message: models.length ? 'Ollama 已连接。' : 'Ollama 已连接，但尚未安装模型。' }
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法连接到 Ollama。'
    return { available: false, models: [], message: `Ollama 不可用：${message}` }
  }
}

export async function enrichWithOllama(input: {
  url: string
  model: string
  word: string
  existingCategories: string[]
}): Promise<AiEnrichment> {
  const response = await fetch(endpoint(input.url, '/api/chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: input.model,
      stream: false,
      format: z.toJSONSchema(enrichmentSchema),
      messages: [
        {
          role: 'system',
          content:
            '你是英语词汇助理。只返回符合 schema 的 JSON。IPA 必须使用英式发音；词性用简洁英文缩写或英文词性；中文释义简洁准确。分类优先从 existingCategories 选择；没有合适项可给出一个短的新分类名。不要给出词根、例句、解释或 markdown。'
        },
        {
          role: 'user',
          content: JSON.stringify({ word: input.word, existingCategories: input.existingCategories })
        }
      ]
    })
  })
  if (!response.ok) throw new Error(`Ollama 生成失败（${response.status}）。`)
  const payload = (await response.json()) as { message?: { content?: string } }
  const content = payload.message?.content
  if (!content) throw new Error('Ollama 没有返回内容。')
  const parsed = enrichmentSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new Error('Ollama 返回的字段不完整。')
  return {
    ipaUk: parsed.data.ipaUk,
    senses: parsed.data.senses,
    suggestedCategory: parsed.data.suggestedCategory?.trim() || null,
    tagNames: parsed.data.suggestedTags.map((tag) => tag.trim()).filter(Boolean)
  }
}
