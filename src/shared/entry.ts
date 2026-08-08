import type { EntryType, PhraseComponent } from './types'

export const MAX_ENTRY_TOKENS = 8
export const MAX_BATCH_ENTRIES = 5000

export interface WordBatchRejection {
  input: string
  reason: string
}

export interface WordBatchResult {
  total: number
  added: number
  duplicates: number
  rejected: WordBatchRejection[]
}

export interface ParsedEntryBatch {
  entries: string[]
  rejected: WordBatchRejection[]
}
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

export const filterPhraseComponents = (phrase: string, components: PhraseComponent[]): PhraseComponent[] => {
  const tokens = new Map(entryTokens(phrase).map((token) => [token.toLocaleLowerCase('en-US'), token]))
  const seen = new Set<string>()
  return components.flatMap((component) => {
    const text = component.text.trim()
    const matchedToken = tokens.get(text.toLocaleLowerCase('en-US'))
    const meaningZh = component.meaningZh.trim()
    const key = matchedToken?.toLocaleLowerCase('en-US')
    if (!matchedToken || !meaningZh || !key || seen.has(key)) return []
    seen.add(key)
    return [{ text: matchedToken, meaningZh }]
  })
}

export const isEntryToken = (value: string): boolean => ENTRY_TOKEN_PATTERN.test(value)

const IMPORT_HEADER_NAMES = new Set(['word', 'words', 'vocabulary', 'term', 'expression', 'front', '英文', '单词', '词汇'])

const decodeImportCell = (value: string): string => value
  .replace(/^\uFEFF/, '')
  .replace(/\{\{c\d+::(.*?)(?:::[^{}]*)?\}\}/gi, '$1')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .trim()
  .replace(/^(["'])(.*)\1$/, '$2')
  .replace(/\s+/g, ' ')

const importDelimiter = (text: string, sourceName: string): string | null => {
  const directive = text.match(/^#separator:(.+)$/im)?.[1]?.trim().toLocaleLowerCase('en-US')
  if (directive === 'tab' || directive === '\\t') return '\t'
  if (directive === 'semicolon') return ';'
  if (directive === 'comma') return ','
  const extension = sourceName.toLocaleLowerCase('en-US')
  if (extension.endsWith('.tsv')) return '\t'
  if (extension.endsWith('.csv')) return ','
  if (text.includes('\t')) return '\t'
  return null
}

const parseDelimitedRows = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const normalized = text.replace(/\r\n?/g, '\n')

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell)
      cell = ''
    } else if (character === '\n' && !quoted) {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export const parseEntryBatchText = (text: string, sourceName = ''): ParsedEntryBatch => {
  const delimiter = importDelimiter(text, sourceName)
  const rows = delimiter
    ? parseDelimitedRows(text, delimiter)
    : text.replace(/\r\n?/g, '\n').split('\n').map((line) => [line])
  const meaningfulRows = rows.filter((row) => {
    const joined = row.join('').trim()
    return joined && !joined.startsWith('#')
  })
  const firstCells = meaningfulRows[0]?.map(decodeImportCell) ?? []
  const headerIndex = firstCells.findIndex((cell) => IMPORT_HEADER_NAMES.has(cell.toLocaleLowerCase('en-US')))
  const entries: string[] = []
  const rejected: WordBatchRejection[] = []

  meaningfulRows.forEach((row, rowIndex) => {
    if (rowIndex === 0 && headerIndex >= 0) return
    const cells = row.map(decodeImportCell).filter(Boolean)
    if (!cells.length) return
    const candidate = headerIndex >= 0
      ? decodeImportCell(row[headerIndex] ?? '')
      : cells.find((cell) => entryInputError(cell) === null) ?? cells[0]
    if (entries.length >= MAX_BATCH_ENTRIES) {
      rejected.push({ input: candidate, reason: `单次最多导入 ${MAX_BATCH_ENTRIES} 个词条。` })
      return
    }
    const error = entryInputError(candidate)
    if (error) rejected.push({ input: candidate, reason: error })
    else entries.push(normalizeEntryWhitespace(candidate))
  })

  return { entries, rejected }
}

export const clipboardEntryText = (text: string): string => {
  if (!text.trim() || text.length > 20_000) return ''
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(decodeImportCell).filter(Boolean)
  if (!lines.length || lines.length > 100 || lines.some((line) => entryInputError(line))) return ''
  return lines.map(normalizeEntryWhitespace).join('\n')
}
