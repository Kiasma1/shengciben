import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { RootIndexStatus, RootMatch } from '../shared/types'

type IndexedRoot = Omit<RootMatch, 'matchedVia'>
type IndexFile = {
  version: number
  sourcePath: string
  sourceMtimeMs: number
  updatedAt: string
  entries: Record<string, IndexedRoot[]>
}

const INDEX_VERSION = 2
const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))

const textContent = (value: string): string => decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())

const normalized = (value: string): string => value.trim().toLocaleLowerCase('en-US')
const rootIdentity = (value: string): string =>
  normalized(value)
    .replace(/¹/g, '1')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/⁴/g, '4')
    .replace(/⁵/g, '5')
    .replace(/⁶/g, '6')
    .replace(/⁷/g, '7')
    .replace(/⁸/g, '8')
    .replace(/⁹/g, '9')
    .replace(/[^a-z0-9-]/g, '')

export function lemmaCandidates(word: string): string[] {
  const candidates = new Set<string>()
  const addStemAndCollapsedDouble = (stem: string): void => {
    candidates.add(stem)
    if (/([b-df-hj-np-tv-z])\1$/i.test(stem)) candidates.add(stem.slice(0, -1))
  }

  if (word.endsWith('ies') && word.length > 4) candidates.add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ied') && word.length > 4) candidates.add(`${word.slice(0, -3)}y`)
  if (word.endsWith('es') && word.length > 3) candidates.add(word.slice(0, -2))
  if (word.endsWith('s') && word.length > 3) candidates.add(word.slice(0, -1))
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3)
    addStemAndCollapsedDouble(stem)
    candidates.add(`${stem}e`)
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2)
    addStemAndCollapsedDouble(stem)
    candidates.add(word.slice(0, -1))
  }
  return [...candidates].filter((candidate) => candidate !== word)
}

export class RootIndexer {
  private readonly indexPath: string
  private index: IndexFile | null = null

  constructor(dataDirectory: string) {
    this.indexPath = path.join(dataDirectory, 'root-index.json')
  }

  async ensure(sourcePath: string): Promise<RootIndexStatus> {
    if (!sourcePath || !existsSync(sourcePath)) {
      this.index = null
      return this.status(sourcePath, '未找到词根辞典文件。')
    }

    const sourceStat = await fs.stat(sourcePath)
    if (!this.index) await this.loadCached()
    if (
      !this.index ||
      this.index.version !== INDEX_VERSION ||
      this.index.sourcePath !== sourcePath ||
      this.index.sourceMtimeMs !== sourceStat.mtimeMs
    ) {
      await this.build(sourcePath, sourceStat.mtimeMs)
    }
    return this.status(sourcePath, '词根索引已就绪。')
  }

  async rebuild(sourcePath: string): Promise<RootIndexStatus> {
    if (!sourcePath || !existsSync(sourcePath)) return this.status(sourcePath, '未找到词根辞典文件。')
    const sourceStat = await fs.stat(sourcePath)
    await this.build(sourcePath, sourceStat.mtimeMs)
    return this.status(sourcePath, '词根索引已重新建立。')
  }

  async match(word: string, sourcePath: string): Promise<RootMatch[]> {
    await this.ensure(sourcePath)
    if (!this.index) return []

    const exactKey = normalized(word)
    const exact = this.index.entries[exactKey]
    if (exact?.length) return exact.map((match) => ({ ...match, matchedVia: 'exact' }))

    for (const lemma of lemmaCandidates(exactKey)) {
      const matches = this.index.entries[lemma]
      if (matches?.length) return matches.map((match) => ({ ...match, matchedVia: 'lemma' }))
    }
    return []
  }

  currentStatus(sourcePath: string): RootIndexStatus {
    if (!this.index || this.index.sourcePath !== sourcePath) return this.status(sourcePath, '尚未建立词根索引。')
    return this.status(sourcePath, '词根索引已就绪。')
  }

  private async loadCached(): Promise<void> {
    if (!existsSync(this.indexPath)) return
    try {
      this.index = JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as IndexFile
    } catch {
      this.index = null
    }
  }

  private async build(sourcePath: string, sourceMtimeMs: number): Promise<void> {
    const html = await fs.readFile(sourcePath, 'utf8')
    const markup = this.extractMarkup(html)
    const entries = this.parseEntries(markup)
    this.index = {
      version: INDEX_VERSION,
      sourcePath,
      sourceMtimeMs,
      updatedAt: new Date().toISOString(),
      entries
    }
    const temporaryPath = `${this.indexPath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(this.index), 'utf8')
    await fs.rename(temporaryPath, this.indexPath)
  }

  private extractMarkup(html: string): string {
    const chunks: string[] = []
    const scriptPattern = /<script\b[^>]*class=["'][^"']*book-letter-chunk[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi
    for (const match of html.matchAll(scriptPattern)) {
      try {
        const payload = JSON.parse(match[1]) as { markup?: string }
        if (payload.markup) chunks.push(payload.markup)
      } catch {
        // A malformed chunk is ignored; the rest of the dictionary remains usable.
      }
    }
    return chunks.length ? chunks.join('\n') : html
  }

  private parseEntries(markup: string): Record<string, IndexedRoot[]> {
    const entries = new Map<string, IndexedRoot[]>()
    const rootMetadata = new Map<string, IndexedRoot>()
    const sectionPattern = /<h2\b([^>]*)>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi

    for (const section of markup.matchAll(sectionPattern)) {
      if (!/<code\b/i.test(section[2])) continue
      const attributes = section[1]
      const heading = textContent(section[2]).replace(/（续）|\(续\)/g, '').trim()
      const root = heading.replace(/^构词成分[：:]?\s*/u, '').trim()
      if (!root || !/[a-z]/i.test(root) || root.length > 80) continue

      const anchor = /\bid=["']([^"']+)["']/i.exec(attributes)?.[1] ?? ''
      const meaning = this.extractMeaning(section[3])
      const rootMatch: IndexedRoot = {
        root,
        meaning,
        formationNote: '',
        sourceAnchor: anchor,
        sourceLabel: `词根 ${root}`
      }
      for (const form of root.split(',')) {
        const key = rootIdentity(form)
        if (key) rootMetadata.set(key, rootMatch)
      }
      const examples = this.extractWordExamples(section[3])
      for (const example of examples) {
        const key = normalized(example.word)
        if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(key) || key.length < 2) continue
        const existing = entries.get(key) ?? []
        const wordMatch = { ...rootMatch, formationNote: example.formationNote }
        if (!existing.some((item) => item.root === wordMatch.root && item.sourceAnchor === wordMatch.sourceAnchor)) existing.push(wordMatch)
        entries.set(key, existing)
      }
    }

    const englishIndex = /<article\b[^>]*id=["']letter-english-root-index["'][^>]*>([\s\S]*?)<\/article>/i.exec(markup)?.[1] ?? ''
    const indexItemPattern = /<li>\s*<strong>([\s\S]*?)<\/strong>\s*(?:（[^）]*）)?\s*[:：]\s*<code>([\s\S]*?)<\/code>\s*<\/li>/gi
    for (const item of englishIndex.matchAll(indexItemPattern)) {
      const word = textContent(item[1])
      const key = normalized(word)
      if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(key)) continue
      const rootForms = textContent(item[2]).split(/[,、]/).map((form) => form.trim()).filter(Boolean)
      const resolved = rootForms.map((form) => {
        const metadata = rootMetadata.get(rootIdentity(form))
        return metadata
          ? { ...metadata, formationNote: '由原辞典“英→根索引”关联。' }
          : {
              root: form,
              meaning: '词根义待在原辞典中查看',
              formationNote: '由原辞典“英→根索引”关联。',
              sourceAnchor: 'letter-english-root-index',
              sourceLabel: '英→根索引'
            }
      })
      const existing = entries.get(key) ?? []
      for (const match of resolved) {
        if (!existing.some((item) => item.root === match.root && item.sourceAnchor === match.sourceAnchor)) existing.push(match)
      }
      entries.set(key, existing)
    }
    return Object.fromEntries(entries)
  }

  private extractMeaning(section: string): string {
    const match = /核心词根义<\/(?:strong|b)>[：:]?\s*([\s\S]*?)<\/li>/i.exec(section)
    if (!match) return '词根义待在原辞典中查看'
    const value = textContent(match[1]).replace(/^[:：]\s*/, '')
    return value || '词根义待在原辞典中查看'
  }

  private extractWordExamples(section: string): { word: string; formationNote: string }[] {
    const examples: { word: string; formationNote: string }[] = []
    const listStack: { firstCode: string | null; markup: string }[] = []
    const tokenPattern = /<li\b[^>]*>|<\/li>|<code\b[^>]*>([\s\S]*?)<\/code>|<[^>]*>|[^<]+/gi
    for (const token of section.matchAll(tokenPattern)) {
      const value = token[0]
      if (/^<li\b/i.test(value)) {
        listStack.push({ firstCode: null, markup: '' })
      } else if (/^<\/li/i.test(value)) {
        const item = listStack.pop()
        if (item?.firstCode) {
          const fullText = textContent(item.markup)
          const formationNote = fullText.toLocaleLowerCase('en-US').startsWith(item.firstCode.toLocaleLowerCase('en-US'))
            ? fullText.slice(item.firstCode.length).replace(/^[:：\s]+/, '').trim()
            : fullText
          examples.push({
            word: item.firstCode,
            formationNote: formationNote.length > 360 ? `${formationNote.slice(0, 360).trim()}…` : formationNote
          })
        }
      } else if (listStack.length) {
        for (const item of listStack) item.markup += value
        if (token[1]) {
          const item = listStack[listStack.length - 1]
          if (!item.firstCode) item.firstCode = textContent(token[1])
        }
      }
    }
    return examples
  }

  private status(sourcePath: string, message: string): RootIndexStatus {
    return {
      sourcePath,
      indexedWords: this.index && this.index.sourcePath === sourcePath ? Object.keys(this.index.entries).length : 0,
      updatedAt: this.index && this.index.sourcePath === sourcePath ? this.index.updatedAt : null,
      ready: Boolean(this.index && this.index.sourcePath === sourcePath),
      message
    }
  }
}
