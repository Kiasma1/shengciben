import type { EntryType, PhraseComponent } from './types'

export const MAX_ENTRY_TOKENS = 8
export const COMMON_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'and', 'or', 'but', 'for', 'with'
])

const ENTRY_TOKEN_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/i
const SENTENCE_SUBJECTS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they'])
const SENTENCE_AUXILIARIES = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'must'
])

export const normalizeEntryWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ')

export const entryTokens = (value: string): string[] => {
  const cleaned = normalizeEntryWhitespace(value)
  return cleaned ? cleaned.split(' ') : []
}

export const entryTypeFor = (value: string): EntryType => entryTokens(value).length > 1 ? 'phrase' : 'word'

export const entryInputError = (value: string): string | null => {
  const tokens = entryTokens(value)
  if (!tokens.length) return '请输入英文单词或短语。'
  if (tokens.length > MAX_ENTRY_TOKENS) return `请输入英文单词或最多 ${MAX_ENTRY_TOKENS} 个词组成的短语。`
  if (tokens.some((token) => !ENTRY_TOKEN_PATTERN.test(token))) return '只允许英文字母、空格、连字符和撇号。'

  const first = tokens[0].toLocaleLowerCase('en-US')
  const second = tokens[1]?.toLocaleLowerCase('en-US')
  if (tokens.length >= 3 && SENTENCE_SUBJECTS.has(first) && second && (SENTENCE_AUXILIARIES.has(second) || second.endsWith("'re") || second.endsWith("'ve") || second.endsWith("'t") || second.endsWith("'m") || second.endsWith("'s") || second.endsWith("'ll") || second.endsWith("'d"))) {
    return '请输入词汇或短语，不要输入完整句子。'
  }
  return null
}

export const isValidEntryInput = (value: string): boolean => entryInputError(value) === null

export const validatePhraseComponents = (phrase: string, components: PhraseComponent[]): PhraseComponent[] => {
  const tokens = new Map(entryTokens(phrase).map((token) => [token.toLocaleLowerCase('en-US'), token]))
  const result = components.map((component) => {
    const text = component.text.trim()
    const matchedToken = tokens.get(text.toLocaleLowerCase('en-US'))
    if (!matchedToken || !component.meaningZh.trim()) throw new Error(`AI 返回了无效的短语组成词：${text || '空值'}。`)
    return { text: matchedToken, meaningZh: component.meaningZh.trim() }
  })
  if (new Set(result.map((component) => component.text.toLocaleLowerCase('en-US'))).size !== result.length) {
    throw new Error('AI 返回了重复的短语组成词。')
  }
  return result
}

export const isEntryToken = (value: string): boolean => ENTRY_TOKEN_PATTERN.test(value)
