import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { RootIndexStatus, RootMatch } from '../shared/types'

type IndexedRoot = Omit<RootMatch, 'matchedVia'>
type DictionaryExample = {
  word: string
  formationNote: string
  rootReferences: string[]
}
type ParsedRootSection = {
  markup: string
  rootMatch: IndexedRoot
}
type IndexFile = {
  version: number
  sourcePath: string
  sourceMtimeMs: number
  updatedAt: string
  entries: Record<string, IndexedRoot[]>
}

const INDEX_VERSION = 3
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
const rootLookupIdentity = (value: string): string => rootIdentity(value).replace(/^-+|-+$/g, '')
const rootForms = (value: string): string[] =>
  value
    .split(/[,、/]/)
    .map((form) => form.trim())
    .filter(Boolean)
const isRootHeading = (value: string): boolean => {
  const forms = rootForms(value)
  return Boolean(forms.length && forms.every((form) => /^-?[a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*$/i.test(form)))
}

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
    const parsedSections: ParsedRootSection[] = []
    const sectionPattern = /<h2\b([^>]*)>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi

    for (const section of markup.matchAll(sectionPattern)) {
      const attributes = section[1]
      const rawHeading = textContent(section[2]).replace(/^构词成分[：:]?\s*/u, '').trim()
      const continuation = /（续）|\(续\)/.test(rawHeading)
      const bracketMeaning = /\[([^\]]+)]\s*$/.exec(rawHeading)?.[1]?.trim() ?? ''
      const root = rawHeading
        .replace(/（续）|\(续\)/g, '')
        .replace(/\[[^\]]+]\s*$/, '')
        .trim()
      if (!root || root.length > 80 || !isRootHeading(root)) continue

      const anchor = /\bid=["']([^"']+)["']/i.exec(attributes)?.[1] ?? ''
      const existingMetadata = continuation
        ? rootForms(root)
            .map((form) => rootMetadata.get(rootLookupIdentity(form)))
            .find((metadata): metadata is IndexedRoot => Boolean(metadata))
        : undefined
      const canonicalRoot = existingMetadata?.root ?? root
      const meaning = existingMetadata?.meaning ?? this.extractMeaning(section[3], bracketMeaning)
      const rootMatch: IndexedRoot = {
        root: canonicalRoot,
        meaning,
        formationNote: '',
        sourceAnchor: anchor,
        sourceLabel: `词根 ${canonicalRoot}`
      }
      parsedSections.push({ markup: section[3], rootMatch })

      for (const form of rootForms(canonicalRoot)) {
        const key = rootLookupIdentity(form)
        if (key && !rootMetadata.has(key)) rootMetadata.set(key, rootMatch)
      }
    }

    for (const section of parsedSections) {
      const examples = [
        ...this.extractWordExamples(section.markup).map((example) => ({ ...example, rootReferences: [] })),
        ...this.extractEmphasizedExamples(section.markup)
      ]
      for (const example of examples) {
        const key = normalized(example.word)
        if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(key) || key.length < 2) continue
        const existing = entries.get(key) ?? []
        const wordMatch = { ...section.rootMatch, formationNote: example.formationNote }
        if (!existing.some((item) => item.root === wordMatch.root && item.sourceAnchor === wordMatch.sourceAnchor)) existing.push(wordMatch)

        for (const reference of example.rootReferences) {
          const referenceKey = rootLookupIdentity(reference)
          const metadata = rootMetadata.get(referenceKey)
          if (!metadata) continue
          const displayRoot =
            rootForms(metadata.root).find((form) => rootLookupIdentity(form) === referenceKey) ??
            reference
          const referenceMatch: IndexedRoot = {
            ...metadata,
            root: displayRoot,
            formationNote: example.formationNote,
            sourceLabel: `词根 ${displayRoot}`
          }
          if (!existing.some((item) => item.root === referenceMatch.root && item.sourceAnchor === referenceMatch.sourceAnchor)) {
            existing.push(referenceMatch)
          }
        }
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

  private extractMeaning(section: string, headingMeaning = ''): string {
    const match = /核心词根义\s*[：:]?\s*<\/(?:strong|b)>\s*[：:]?\s*([\s\S]*?)<\/li>/i.exec(section)
    if (match) {
      const value = textContent(match[1]).replace(/^[:：]\s*/, '')
      if (value) return value
    }
    if (headingMeaning) return headingMeaning
    const introduction = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(section)?.[1] ?? ''
    const quotedMeaning = /「([^」]{1,120})」/.exec(textContent(introduction))?.[1]?.trim()
    return quotedMeaning || '词根义待在原辞典中查看'
  }

  private extractEmphasizedExamples(section: string): DictionaryExample[] {
    const examples: DictionaryExample[] = []
    const listItemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
    const exampleLabelPattern = /基础词根|词根词|加前缀词根|加后缀词根|复合词|派生词|例词|examples?/i
    const emphasizedWordPattern = /<(em|code)\b[^>]*>([\s\S]*?)<\/\1>\s*(?:（[^）]{0,80}）\s*)?「/gi

    for (const item of section.matchAll(listItemPattern)) {
      const strong = /^\s*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*[：:]?/i.exec(item[1])
      if (!strong || !exampleLabelPattern.test(textContent(strong[1]))) continue
      const body = item[1].slice(strong[0].length)
      for (const clause of body.split(/[；;]/)) {
        const referenceMarker = /(?:其中|源自|来自|由)\s*/.exec(clause)
        const exampleMarkup = referenceMarker ? clause.slice(0, referenceMarker.index) : clause
        const referenceMarkup = referenceMarker ? clause.slice(referenceMarker.index + referenceMarker[0].length) : ''
        const rootReferences = [...referenceMarkup.matchAll(emphasizedWordPattern)]
          .map((match) => textContent(match[2]))
          .filter((word) => /^[a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*$/i.test(word))
        const formationNote = textContent(clause)
        const clippedNote = formationNote.length > 360 ? `${formationNote.slice(0, 360).trim()}…` : formationNote

        for (const candidate of exampleMarkup.matchAll(emphasizedWordPattern)) {
          const word = textContent(candidate[2])
          if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) continue
          examples.push({ word, formationNote: clippedNote, rootReferences })
        }
      }
    }
    return examples
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
