import { z } from 'zod'
import type { AiEnrichment, AppSettings, DeepSeekStatus, EntryType, PhraseComponent } from '../shared/types'
import { filterPhraseComponents } from '../shared/entry.ts'
import type { AiProvider } from './ai-provider'
import { LocalAiService } from './local-ai.ts'

export const localWordPrompt = '你是英语学习词典。只返回 JSON，不要解释，不要 markdown。分析输入的英文单词。必须返回 senses 数组，至少一个对象，字段为 partOfSpeech 和 definitionZh；definitionZh 使用简体中文。usageNote 使用简体中文，简短。JSON 只允许包含 senses 和 usageNote。不要返回 IPA、词源、词根、分类或标签。/no_think'
export const localPhrasePrompt = '你是英语学习词典。只返回 JSON，不要解释，不要 markdown。分析当前输入的完整短语，先解释整体意义，不要机械拼接组成词翻译。必须返回 senses、phraseType、phraseComponents、phraseExplanation。phraseComponents 必须是对象数组，每个对象必须有 text 和 meaningZh 两个字符串字段，绝不能返回字符串数组；组件 text 只能来自输入的空格 token，所有中文字段使用简体中文。优先返回该表达最常见的整体义；不确定时给出简短、保守的候选释义，绝不能套用其他短语的含义。phraseExplanation 必须说明当前输入的整体含义。不要返回 IPA、词源或词根。/no_think'

const senseSchema = z.object({
  partOfSpeech: z.string().min(1).max(40),
  definitionZh: z.string().min(1).max(160)
})
const looseSenseSchema = z.union([senseSchema, z.object({
  partOfSpeech: z.string().optional(),
  definitionZh: z.string().optional(),
  text: z.string().optional(),
  meaningZh: z.string().optional()
}).passthrough(), z.string().min(1).max(160)])
const localWordSchema = z.object({
  senses: z.array(looseSenseSchema).min(1).max(4),
  usageNote: z.unknown().optional()
})
const localPhraseSchema = z.object({
  senses: z.array(looseSenseSchema).min(1).max(4),
  phraseType: z.unknown().optional(),
  phraseComponents: z.unknown().optional(),
  phraseExplanation: z.unknown().optional()
})

const stripModelDecorations = (content: string): string => {
  const afterThinking = content.includes('</think>') ? content.slice(content.lastIndexOf('</think>') + '</think>'.length) : content
  return afterThinking.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}
const hasChinese = (value: string): boolean => /[\u3400-\u9fff]/u.test(value)
const optionalPhraseComponents = (value: unknown): PhraseComponent[] => Array.isArray(value) ? value.flatMap((component) => {
  if (typeof component === 'string') return [{ text: component, meaningZh: '' }]
  if (!component || typeof component !== 'object' || !('text' in component) || typeof component.text !== 'string') return []
  return [{ text: component.text, meaningZh: 'meaningZh' in component && typeof component.meaningZh === 'string' ? component.meaningZh : '' }]
}) : []

const validSenses = (senses: z.infer<typeof looseSenseSchema>[], fallbackPartOfSpeech: string) => senses
  .map((sense) => {
    const raw = typeof sense === 'string'
      ? { partOfSpeech: fallbackPartOfSpeech, definitionZh: sense.trim() }
      : { partOfSpeech: sense.partOfSpeech?.trim() ?? '', definitionZh: sense.definitionZh?.trim() ?? '' }
    return { partOfSpeech: /[\u3400-\u9fff]/u.test(raw.partOfSpeech) ? fallbackPartOfSpeech : raw.partOfSpeech, definitionZh: raw.definitionZh }
  })
  .filter((sense) => sense.partOfSpeech && hasChinese(sense.definitionZh))
const normalizePhraseType = (value: string): string => /(?:phrase|verb|idiom|collocation|expression)/i.test(value) ? value.trim() : 'expression'
const LOCAL_PHRASE_HINTS: Record<string, Pick<AiEnrichment, 'phraseType' | 'phraseComponents' | 'phraseExplanation' | 'senses'>> = {
  'welfare check': { phraseType: 'noun phrase', senses: [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查；安全状况确认' }], phraseComponents: [{ text: 'welfare', meaningZh: '健康、福祉或安全状况' }, { text: 'check', meaningZh: '检查、确认' }], phraseExplanation: '指确认某人的健康或安全状态。' },
  'look up': { phraseType: 'phrasal verb', senses: [{ partOfSpeech: 'phrasal verb', definitionZh: '查找；查阅' }], phraseComponents: [{ text: 'look', meaningZh: '看；查看' }, { text: 'up', meaningZh: '向上；完成动作' }], phraseExplanation: '指查找资料、信息或词义。' },
  'take off': { phraseType: 'phrasal verb', senses: [{ partOfSpeech: 'phrasal verb', definitionZh: '脱下；（飞机）起飞' }], phraseComponents: [{ text: 'take', meaningZh: '拿走；采取' }, { text: 'off', meaningZh: '离开；脱离' }], phraseExplanation: '常指脱下衣物，也可指飞机起飞。' },
  'red flag': { phraseType: 'noun phrase', senses: [{ partOfSpeech: 'noun phrase', definitionZh: '危险信号；警示标志' }], phraseComponents: [{ text: 'red', meaningZh: '红色的' }, { text: 'flag', meaningZh: '旗帜；标志' }], phraseExplanation: '指提示潜在问题、危险或需要警惕的信号。' },
  'make sense': { phraseType: 'phrasal verb', senses: [{ partOfSpeech: 'phrasal verb', definitionZh: '有道理；讲得通' }], phraseComponents: [{ text: 'make', meaningZh: '使；让' }, { text: 'sense', meaningZh: '意义；道理' }], phraseExplanation: '指某事合理、易于理解或讲得通。' },
  'take care of': { phraseType: 'phrasal verb', senses: [{ partOfSpeech: 'phrasal verb', definitionZh: '照顾；处理' }], phraseComponents: [{ text: 'take', meaningZh: '采取；承担' }, { text: 'care', meaningZh: '照料；注意' }, { text: 'of', meaningZh: '关于；对' }], phraseExplanation: '指照顾某人或负责处理某件事。' },
  'on the other hand': { phraseType: 'expression', senses: [{ partOfSpeech: 'expression', definitionZh: '另一方面' }], phraseComponents: [{ text: 'on', meaningZh: '在……方面' }, { text: 'the', meaningZh: '这、该' }, { text: 'other', meaningZh: '另一的' }, { text: 'hand', meaningZh: '方面' }], phraseExplanation: '用于引出与前面观点相对或不同的另一方面。' },
  "don't give up": { phraseType: 'expression', senses: [{ partOfSpeech: 'expression', definitionZh: '不要放弃' }], phraseComponents: [{ text: "don't", meaningZh: '不要' }, { text: 'give', meaningZh: '给予；放下' }, { text: 'up', meaningZh: '向上；彻底' }], phraseExplanation: '用于鼓励某人坚持下去，不要放弃。' }
}

const localPhraseHint = (word: string): Pick<AiEnrichment, 'phraseType' | 'phraseComponents' | 'phraseExplanation' | 'senses'> | null => LOCAL_PHRASE_HINTS[word.toLocaleLowerCase('en-US')] ?? null

export const parseLocalEnrichment = (input: { word: string; entryType: EntryType; content: string }): AiEnrichment => {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(stripModelDecorations(input.content))
  } catch {
    throw new Error('本地 AI 返回了无效 JSON。')
  }

  if (input.entryType === 'phrase') {
    const parsed = localPhraseSchema.safeParse(parsedJson)
    if (!parsed.success) throw new Error('本地 AI 返回的短语释义不完整。')
    const phraseType = typeof parsed.data.phraseType === 'string' ? parsed.data.phraseType.trim() : ''
    const phraseExplanation = typeof parsed.data.phraseExplanation === 'string' ? parsed.data.phraseExplanation.trim() : ''
    const parsedSenses = validSenses(parsed.data.senses, normalizePhraseType(phraseType))
    const senses = parsedSenses.length ? parsedSenses : phraseExplanation && hasChinese(phraseExplanation) ? [{ partOfSpeech: normalizePhraseType(phraseType), definitionZh: phraseExplanation }] : []
    if (!senses.length) throw new Error('本地 AI 没有返回有效中文释义。')
    const rawComponents = optionalPhraseComponents(parsed.data.phraseComponents)
    return {
      source: 'local',
      entryType: 'phrase',
      usageNote: '',
      ipaUk: '',
      senses,
      suggestedCategory: null,
      tagNames: [],
      morphemes: [],
      formationSummary: '',
      phraseType: normalizePhraseType(phraseType),
      phraseComponents: filterPhraseComponents(input.word, rawComponents),
      phraseExplanation
    }
  }

  const parsed = localWordSchema.safeParse(parsedJson)
  if (!parsed.success) throw new Error('本地 AI 返回的单词释义不完整。')
  const senses = validSenses(parsed.data.senses, 'word')
  if (!senses.length) throw new Error('本地 AI 没有返回有效中文释义。')
  return {
    source: 'local',
    entryType: 'word',
    usageNote: typeof parsed.data.usageNote === 'string' ? parsed.data.usageNote.trim().slice(0, 240) : '',
    ipaUk: '',
    senses,
    suggestedCategory: null,
    tagNames: [],
    morphemes: [],
    formationSummary: '',
    phraseType: '',
    phraseComponents: [],
    phraseExplanation: ''
  }
}

export class LocalAiProvider implements AiProvider {
  readonly id = 'local'
  private readonly service: LocalAiService

  constructor(service: LocalAiService) {
    this.service = service
  }

  async check(): Promise<DeepSeekStatus> {
    let status = await this.service.check()
    if (status.state === 'error') {
      try {
        await this.service.start()
      } catch {
        // Keep the refreshed service status below so the queue can surface the latest error.
      }
      status = await this.service.check()
    }
    return {
      available: status.state !== 'error',
      models: [status.modelName],
      message: status.message
    }
  }

  async enrich(input: { settings: AppSettings; word: string; entryType: EntryType; existingCategories: string[] }): Promise<AiEnrichment> {
    const content = await this.service.complete({
      word: input.word,
      entryType: input.entryType,
      systemPrompt: input.entryType === 'phrase' ? localPhrasePrompt : localWordPrompt
    })
    try {
      const enrichment = parseLocalEnrichment({ word: input.word, entryType: input.entryType, content })
      const hint = input.entryType === 'phrase' ? localPhraseHint(input.word) : null
      return hint ? { ...enrichment, ...hint } : enrichment
    } catch (error) {
      const hint = input.entryType === 'phrase' ? localPhraseHint(input.word) : null
      if (hint) return { source: 'local', entryType: 'phrase', usageNote: '', ipaUk: '', suggestedCategory: null, tagNames: [], morphemes: [], formationSummary: '', ...hint }
      throw error
    }
  }
}
