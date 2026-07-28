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
type InlineRootSection = {
  root: string
  continuation: boolean
  headingMeaning: string
  markup: string
  sourceAnchor: string
  offset: number
  declarationEnd: number
}
type ListItemNode = {
  markup: string
  children: ListItemNode[]
}
type IndexFile = {
  version: number
  sourcePath: string
  sourceMtimeMs: number
  updatedAt: string
  entries: Record<string, IndexedRoot[]>
}

const INDEX_VERSION = 9
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
const isLetterChapterHeading = (value: string): boolean => {
  const forms = rootForms(value)
  return Boolean(forms.length && forms.every((form) => /^[A-Z]$/.test(form)))
}
const cleanRootHeading = (value: string): string =>
  value
    .replace(/^构词成分[：:]?\s*/u, '')
    .replace(/([a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*)\s*（亦拼作\s+([a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*)）/gi, '$1 / $2')
    .replace(/\b([a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*)\(([a-z])\)/gi, '$1$2 / $1')
    .replace(/（续）|\(续\)/g, '')
    .replace(/\s*(?:—{2,}|–{2,}|-{2,})[\s\S]*$/, '')
    .replace(/\s*[—–]\s+[\s\S]*$/, '')
    .replace(/\s+-\s+[\s\S]*$/, '')
    .replace(/\[[^\]]+]\s*$/, '')
    .replace(/\s*[：:][\s\S]*$/, '')
    .replace(/\s*[〔（(][\s\S]*$/, '')
    .trim()
const rootHeadingFromMarkup = (markup: string): string => {
  const rawHeading = textContent(markup).replace(/^构词成分[：:]?\s*/u, '').trim()
  const leadingMarkup = markup.split(/[（(〔]/, 1)[0]
  if (/^\s*<code\b/i.test(leadingMarkup)) {
    const codeForms = [...leadingMarkup.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)]
      .map((match) => textContent(match[1]))
      .filter((form) => isRootHeading(form))
    if (codeForms.length) return codeForms.join('、')
  }
  return cleanRootHeading(rawHeading)
}
const splitDictionaryClauses = (value: string): string[] => {
  const clauses: string[] = []
  let start = 0
  let parenthesisDepth = 0
  let quoteDepth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '（' || character === '(' || character === '〔' || character === '[') parenthesisDepth += 1
    else if (character === '）' || character === ')' || character === '〕' || character === ']') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
    }
    else if (character === '「') quoteDepth += 1
    else if (character === '」') quoteDepth = Math.max(0, quoteDepth - 1)
    else if ((character === '；' || character === ';' || character === '。') && parenthesisDepth === 0 && quoteDepth === 0) {
      clauses.push(value.slice(start, index))
      start = index + 1
    }
  }
  clauses.push(value.slice(start))
  return clauses
}
const isInsideParentheses = (value: string, offset: number): boolean => {
  let depth = 0
  for (let index = 0; index < offset; index += 1) {
    if (value[index] === '（' || value[index] === '(' || value[index] === '〔' || value[index] === '[') depth += 1
    else if (value[index] === '）' || value[index] === ')' || value[index] === '〕' || value[index] === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return depth > 0
}
const firstTopLevelOffset = (value: string, characters: ReadonlySet<string>): number => {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '（' || character === '(' || character === '〔' || character === '[') depth += 1
    else if (character === '）' || character === ')' || character === '〕' || character === ']') {
      depth = Math.max(0, depth - 1)
    }
    else if (depth === 0 && characters.has(character)) return index
  }
  return value.length
}
const listItemForest = (section: string): ListItemNode[] => {
  const roots: ListItemNode[] = []
  const stack: ListItemNode[] = []
  const tokenPattern = /<li\b[^>]*>|<\/li>|<[^>]*>|[^<]+/gi
  for (const token of section.matchAll(tokenPattern)) {
    const value = token[0]
    if (/^<li\b/i.test(value)) {
      const node: ListItemNode = { markup: '', children: [] }
      const parent = stack.at(-1)
      if (parent) parent.children.push(node)
      else roots.push(node)
      stack.push(node)
    } else if (/^<\/li/i.test(value)) {
      stack.pop()
    } else if (stack.length) {
      stack[stack.length - 1].markup += value
    }
  }
  return roots
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
    if (exact?.length) return this.withMatchMode(exact, 'exact')

    for (const lemma of lemmaCandidates(exactKey)) {
      const matches = this.index.entries[lemma]
      if (matches?.length) return this.withMatchMode(matches, 'lemma')
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
    const englishIndexPattern =
      /<article\b[^>]*id=["']letter-english-root-index["'][^>]*>([\s\S]*?)<\/article>/i
    const englishIndexMatch = englishIndexPattern.exec(markup)
    const englishIndex = englishIndexMatch?.[1] ?? ''
    const dictionaryMarkup = markup.replace(englishIndexPattern, '')
    const headingPattern = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi
    const headings = [...dictionaryMarkup.matchAll(headingPattern)]

    for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      const heading = headings[headingIndex]
      const attributes = heading[2]
      const rawHeading = textContent(heading[3]).replace(/^构词成分[：:]?\s*/u, '').trim()
      if (isLetterChapterHeading(rawHeading)) continue
      const continuation = /（续）|\(续\)/.test(rawHeading)
      const bracketMeaning = /\[([^\]]+)]\s*$/.exec(rawHeading)?.[1]?.trim() ?? ''
      const root = rootHeadingFromMarkup(heading[3])
      if (!root || isLetterChapterHeading(root) || root.length > 80 || !isRootHeading(root)) continue

      const bodyStart = (heading.index ?? 0) + heading[0].length
      const nextHeading = headings
        .slice(headingIndex + 1)
        .find((candidate) => {
          if (Number(candidate[1]) === 2) return true
          const candidateRoot = rootHeadingFromMarkup(candidate[3])
          return Boolean(candidateRoot && !isLetterChapterHeading(candidateRoot) && isRootHeading(candidateRoot))
        })
      const bodyEnd = nextHeading?.index ?? dictionaryMarkup.length
      const fullSectionMarkup = dictionaryMarkup.slice(bodyStart, bodyEnd)
      const anchor = /\bid=["']([^"']+)["']/i.exec(attributes)?.[1] ?? ''
      const existingMetadata = continuation
        ? rootForms(root)
            .map((form) => rootMetadata.get(rootLookupIdentity(form)))
            .find((metadata): metadata is IndexedRoot => Boolean(metadata))
        : undefined
      const canonicalRoot = existingMetadata?.root ?? root
      const inlineSections = this.extractInlineRootSections(fullSectionMarkup, canonicalRoot, anchor)
      const sectionMarkup = inlineSections.length ? fullSectionMarkup.slice(0, inlineSections[0].offset) : fullSectionMarkup
      const meaning = existingMetadata?.meaning ?? this.extractMeaning(sectionMarkup, bracketMeaning)
      const rootMatch: IndexedRoot = {
        root: canonicalRoot,
        meaning,
        formationNote: '',
        sourceAnchor: anchor,
        sourceLabel: `词根 ${canonicalRoot}`
      }
      parsedSections.push({ markup: sectionMarkup, rootMatch })

      for (const form of rootForms(canonicalRoot)) {
        const key = rootLookupIdentity(form)
        if (key && !rootMetadata.has(key)) rootMetadata.set(key, rootMatch)
      }

      for (const inlineSection of inlineSections) {
        const inlineMetadata = inlineSection.continuation
          ? rootForms(inlineSection.root)
              .map((form) => rootMetadata.get(rootLookupIdentity(form)))
              .find((metadata): metadata is IndexedRoot => Boolean(metadata))
          : undefined
        const inlineCanonicalRoot = inlineMetadata?.root ?? inlineSection.root
        const inlineRootMatch: IndexedRoot = {
          root: inlineCanonicalRoot,
          meaning: inlineMetadata?.meaning ?? this.extractMeaning(inlineSection.markup, inlineSection.headingMeaning),
          formationNote: '',
          sourceAnchor: inlineSection.sourceAnchor,
          sourceLabel: `词根 ${inlineCanonicalRoot}`
        }
        parsedSections.push({ markup: inlineSection.markup, rootMatch: inlineRootMatch })
        for (const form of rootForms(inlineCanonicalRoot)) {
          const key = rootLookupIdentity(form)
          if (key && !rootMetadata.has(key)) rootMetadata.set(key, inlineRootMatch)
        }
      }
    }

    for (const section of parsedSections) {
      const exampleMarkup = this.withoutIgnoredSubsections(section.markup)
      const examples = [
        ...this.extractTaggedExamples(exampleMarkup, section.rootMatch.root).map((example) => ({
          ...example,
          rootReferences: []
        })),
        ...this.extractEmphasizedExamples(exampleMarkup)
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

    const indexItemPattern = /<li>\s*<strong>([\s\S]*?)<\/strong>\s*(?:（[^）]*）)?\s*[:：]\s*<code>([\s\S]*?)<\/code>\s*<\/li>/gi
    for (const item of englishIndex.matchAll(indexItemPattern)) {
      const word = textContent(item[1])
      const key = normalized(word)
      if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(key)) continue
      const indexedRootForms = rootForms(textContent(item[2]))
        .map((form) => form.trim())
        .filter((form) => Boolean(form) && !/^[A-Z]$/.test(form))
      const resolved = indexedRootForms.map((form) => {
        const metadata = rootMetadata.get(rootLookupIdentity(form))
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

  private extractInlineRootSections(section: string, currentRoot: string, parentAnchor: string): InlineRootSection[] {
    const currentForms = new Set(rootForms(currentRoot).map((form) => rootLookupIdentity(form)))
    const declarationPattern = /<p\b[^>]*>\s*<strong\b[^>]*>([^<]{1,80})<\/strong>\s*　+/gi
    const rawDeclarations = [...section.matchAll(declarationPattern)].flatMap((declaration) => {
      const rawHeading = textContent(declaration[1]).trim()
      const continuation = /（续）|\(续\)/.test(rawHeading)
      const headingMeaning = /\[([^\]]+)]\s*$/.exec(rawHeading)?.[1]?.trim() ?? ''
      const root = cleanRootHeading(rawHeading)
      if (!root || !isRootHeading(root)) return []
      const candidateForms = rootForms(root).map((form) => rootLookupIdentity(form))
      if (candidateForms.some((form) => currentForms.has(form))) return []
      const offset = declaration.index ?? 0
      return [{ root, continuation, headingMeaning, offset, declarationEnd: offset + declaration[0].length }]
    })
    const declarations: typeof rawDeclarations = []
    for (const declaration of rawDeclarations) {
      const previous = declarations.at(-1)
      if (previous) {
        const betweenDeclarations = section.slice(previous.declarationEnd, declaration.offset)
        const previousForms = rootForms(previous.root).map((form) => rootLookupIdentity(form))
        const candidateForms = rootForms(declaration.root).map((form) => rootLookupIdentity(form))
        const relatedForms = previousForms.some((previousForm) =>
          candidateForms.some((candidateForm) =>
            Math.min(previousForm.length, candidateForm.length) >= 3 &&
            (candidateForm.startsWith(previousForm) || previousForm.startsWith(candidateForm))
          )
        )
        if (relatedForms && !/<(?:ul|li|strong)\b/i.test(betweenDeclarations)) continue
      }
      declarations.push(declaration)
    }

    return declarations.map((declaration, index) => {
      const end = declarations[index + 1]?.offset ?? section.length
      const precedingMarkup = section.slice(0, declaration.offset)
      const pageAnchors = [...precedingMarkup.matchAll(/\bid=["'](pdf-page-\d+)["']/gi)]
      return {
        ...declaration,
        markup: section.slice(declaration.offset, end),
        sourceAnchor: pageAnchors.at(-1)?.[1] ?? parentAnchor
      }
    })
  }

  private withoutIgnoredSubsections(section: string): string {
    const headings = [...section.matchAll(/<h([3-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    let cursor = 0
    let result = ''
    for (let index = 0; index < headings.length; index += 1) {
      const heading = headings[index]
      const label = textContent(heading[2])
      if (!/^(?:(?:交叉参见|参见)(?:（[^）]*）)?|cross\s*reference\b)/i.test(label)) continue
      const start = heading.index ?? 0
      if (start < cursor) continue
      result += section.slice(cursor, start)
      cursor = headings[index + 1]?.index ?? section.length
    }
    return `${result}${section.slice(cursor)}`
  }

  private extractMeaning(section: string, headingMeaning = ''): string {
    const match =
      /(?:核心词根义|词义)\s*(?:（[^）]*）|\([^)]*\))?\s*[：:]?\s*<\/(?:strong|b)>\s*[：:]?\s*([\s\S]*?)<\/li>/i.exec(
        section
      )
    if (match) {
      const value = textContent(match[1]).replace(/^[:：]\s*/, '')
      if (value) return value
    }
    if (headingMeaning) return headingMeaning
    const introduction = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(section)?.[1] ?? ''
    const quotedMeaning = /(?:「([^」]{1,120})」|“([^”]{1,120})”)/.exec(textContent(introduction))
    const quotedValue = quotedMeaning?.[1]?.trim() ?? quotedMeaning?.[2]?.trim()
    return quotedValue || '词根义待在原辞典中查看'
  }

  private extractEmphasizedExamples(section: string): DictionaryExample[] {
    const examples: DictionaryExample[] = []
    const listItemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
    const emphasizedWordPattern = /<(em|code)\b[^>]*>([\s\S]*?)<\/\1>\s*(?:（[^）]{0,80}）\s*)?「/gi

    for (const item of section.matchAll(listItemPattern)) {
      const strong = /^\s*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*[：:]?/i.exec(item[1])
      const body = strong ? item[1].slice(strong[0].length) : item[1]
      for (const clause of splitDictionaryClauses(body)) {
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
          const candidateIndex = candidate.index ?? 0
          if (isInsideParentheses(exampleMarkup, candidateIndex)) continue
          const precedingText = textContent(exampleMarkup.slice(0, candidateIndex))
          if (/(?:同义词|参见|复数|例如|如|与|同|见|比较|对照)[：:]?\s*$/i.test(precedingText)) continue
          examples.push({ word, formationNote: clippedNote, rootReferences })
        }
      }
    }
    return examples
  }

  private extractTaggedExamples(section: string, currentRoot: string): { word: string; formationNote: string }[] {
    const examples: { word: string; formationNote: string }[] = []
    const nonHeadwordLabels = new Set([
      'antonyms',
      'english',
      'examples',
      'french',
      'from',
      'german',
      'ie',
      'italian',
      'latin',
      'meaning',
      'none',
      'russian',
      'spanish',
      'synonyms'
    ])
    const ignoredLabel =
      /^(?:(?:交叉参见|参见|同义词|近义词)(?:（[^）]*）)?|(?:cross\s*reference|synonyms?|antonyms?)\b)/i
    const validWord = /^[a-z]+(?:[-'][a-z]+)*$/i
    const currentRootKeys = rootForms(currentRoot).map((form) => rootLookupIdentity(form))

    const visit = (node: ListItemNode): void => {
      const formationNote = textContent(node.markup).replace(/^[:：\s]+/, '').trim()
      const clippedNote = formationNote.length > 360 ? `${formationNote.slice(0, 360).trim()}…` : formationNote
      const nodeExamples: { word: string; formationNote: string }[] = []
      let ignored = false
      let familyHeadwordKey = ''

      const collectCandidates = (candidateMarkup: string, requiredFamily = ''): void => {
        const leadingTag = /^\s*<(code|strong)\b/i.exec(candidateMarkup)?.[1]?.toLocaleLowerCase('en-US')
        if (!leadingTag) return
        const candidatePattern = new RegExp(`<${leadingTag}\\b[^>]*>([\\s\\S]*?)<\\/${leadingTag}>`, 'gi')
        let previousCandidateEnd = -1
        for (const candidate of candidateMarkup.matchAll(candidatePattern)) {
          if (isInsideParentheses(candidateMarkup, candidate.index ?? 0)) continue
          if (previousCandidateEnd >= 0) {
            const separator = textContent(candidateMarkup.slice(previousCandidateEnd, candidate.index ?? 0))
            if (!/[、,，/]\s*$/.test(separator)) continue
          }
          let acceptedCandidate = false
          for (const word of textContent(candidate[1]).split(/[,、]/).map((value) => value.trim())) {
            if (!validWord.test(word) || nonHeadwordLabels.has(normalized(word))) continue
            const wordKey = normalized(word)
            if (requiredFamily && !wordKey.includes(requiredFamily)) continue
            if (
              nodeExamples.some((example) => {
                const earlierKey = normalized(example.word)
                return earlierKey.length > wordKey.length && earlierKey.includes(wordKey)
              })
            ) {
              continue
            }
            nodeExamples.push({ word, formationNote: clippedNote })
            acceptedCandidate = true
          }
          if (acceptedCandidate) previousCandidateEnd = (candidate.index ?? 0) + candidate[0].length
        }
      }

      for (const rawClause of splitDictionaryClauses(node.markup)) {
        if (nodeExamples.length && !familyHeadwordKey) break
        let clause = rawClause
          .replace(/^\s*<(?:p|div)\b[^>]*>\s*/i, '')
          .replace(/\s*<\/(?:p|div)>\s*$/i, '')
        const leadingStrong = /^\s*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*[：:]?/i.exec(clause)
        if (leadingStrong) {
          const label = textContent(leadingStrong[1])
          if (ignoredLabel.test(label)) {
            ignored = true
            break
          }
          if (!validWord.test(label) || nonHeadwordLabels.has(normalized(label))) {
            clause = clause.slice(leadingStrong[0].length)
          }
        }

        const definitionOffset = firstTopLevelOffset(clause, new Set(['：', ':']))
        const headwordMarkup = clause.slice(0, definitionOffset)
        const examplesBeforeClause = nodeExamples.length
        collectCandidates(headwordMarkup, familyHeadwordKey)
        if (
          !familyHeadwordKey &&
          examplesBeforeClause === 0 &&
          nodeExamples.length === 1 &&
          definitionOffset < clause.length
        ) {
          familyHeadwordKey = normalized(nodeExamples[0].word)
          collectCandidates(clause.slice(definitionOffset + 1), familyHeadwordKey)
        }
      }

      if (ignored) return
      const uniqueNodeExamples = [...new Map(nodeExamples.map((example) => [normalized(example.word), example])).values()]
      const visibleRemainder = textContent(node.markup)
        .replace(/[a-z]+(?:[-'][a-z]+)*/gi, '')
        .replace(/[,、/：:\s-]/g, '')
      const candidateKey = uniqueNodeExamples.length === 1 ? rootLookupIdentity(uniqueNodeExamples[0].word) : ''
      const isRootVariantLabel =
        candidateKey.length > 0 &&
        currentRootKeys.some(
          (rootKey) =>
            Math.abs(rootKey.length - candidateKey.length) <= 1 &&
            (rootKey.startsWith(candidateKey) || candidateKey.startsWith(rootKey))
        )
      const isGroupLabel =
        node.children.length > 0 && uniqueNodeExamples.length === 1 && !visibleRemainder && isRootVariantLabel
      if (!isGroupLabel && uniqueNodeExamples.length) {
        examples.push(...uniqueNodeExamples)
        return
      }
      for (const child of node.children) visit(child)
    }

    for (const node of listItemForest(section)) visit(node)
    return examples
  }

  private withMatchMode(matches: IndexedRoot[], matchedVia: RootMatch['matchedVia']): RootMatch[] {
    const uniqueMatches: IndexedRoot[] = []
    for (const match of matches) {
      const identity = rootIdentity(match.root)
      const forms = new Set(rootForms(match.root).map((form) => rootLookupIdentity(form)))
      const duplicateIndex = uniqueMatches.findIndex((existing) => {
        if (rootIdentity(existing.root) === identity) return true
        const hasEnglishIndexFallback =
          existing.sourceAnchor === 'letter-english-root-index' || match.sourceAnchor === 'letter-english-root-index'
        if (
          hasEnglishIndexFallback &&
          rootLookupIdentity(existing.root).replace(/-/g, '') === rootLookupIdentity(match.root).replace(/-/g, '')
        ) {
          return true
        }
        if (existing.sourceAnchor !== match.sourceAnchor) return false
        return rootForms(existing.root).some((form) => forms.has(rootLookupIdentity(form)))
      })
      if (duplicateIndex < 0) {
        uniqueMatches.push(match)
        continue
      }
      const existing = uniqueMatches[duplicateIndex]
      const existingIsFallback = existing.sourceAnchor === 'letter-english-root-index'
      const matchIsFallback = match.sourceAnchor === 'letter-english-root-index'
      if (
        (existingIsFallback && !matchIsFallback) ||
        (existingIsFallback === matchIsFallback &&
          rootForms(match.root).length > rootForms(existing.root).length)
      ) {
        uniqueMatches[duplicateIndex] = match
      }
    }
    return uniqueMatches.map((match) => ({ ...match, matchedVia }))
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
