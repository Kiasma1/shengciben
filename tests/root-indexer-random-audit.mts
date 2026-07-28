import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RootIndexer } from '../src/main/root-indexer.ts'

const dictionaryPath =
  process.argv[2] ??
  'D:\\考试\\translation_codex\\english-word-roots-zh-codex\\英语词根词源分类辞典-Codex重译版.html'
const html = await readFile(dictionaryPath, 'utf8')
const textContent = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const rootForms = (value: string): string[] => value.split(/[,、/]/).map((form) => form.trim()).filter(Boolean)
const rootIdentity = (value: string): string =>
  value
    .toLocaleLowerCase('en-US')
    .replace(/¹/g, '1')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/⁴/g, '4')
    .replace(/⁵/g, '5')
    .replace(/⁶/g, '6')
    .replace(/⁷/g, '7')
    .replace(/⁸/g, '8')
    .replace(/⁹/g, '9')
    .replace(/[^a-z0-9]/g, '')
const isRootHeading = (value: string): boolean => {
  const forms = rootForms(value)
  return Boolean(forms.length && forms.every((form) => /^-?[a-z][a-z0-9¹²³⁴⁵⁶⁷⁸⁹-]*$/i.test(form)))
}
const splitClauses = (value: string): string[] => {
  const clauses: string[] = []
  let start = 0
  let parenthesisDepth = 0
  let quoteDepth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '（' || character === '(') parenthesisDepth += 1
    else if (character === '）' || character === ')') parenthesisDepth = Math.max(0, parenthesisDepth - 1)
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

const chunks = [...html.matchAll(/<script\b[^>]*class=["'][^"']*book-letter-chunk[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)]
const markup = chunks.length
  ? chunks.map((chunk) => (JSON.parse(chunk[1]) as { markup?: string }).markup ?? '').join('\n')
  : html
const canonicalRoots = new Map<string, string>()
const candidates: { word: string; expectedRoot: string; sourceAnchor: string }[] = []
const sourceRootIdentities = new Set<string>()

for (const heading of markup.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)) {
  const leadingMarkup = heading[1].split(/[（(〔]/, 1)[0]
  const leadingCodeForms = /^\s*<code\b/i.test(leadingMarkup)
    ? [...leadingMarkup.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)]
        .map((match) => textContent(match[1]))
        .filter((form) => isRootHeading(form))
    : []
  const headingText = leadingCodeForms.length
    ? leadingCodeForms.join('、')
    : textContent(heading[1])
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
  if (
    !headingText ||
    rootForms(headingText).every((form) => /^[A-Z]$/.test(form)) ||
    !isRootHeading(headingText)
  ) {
    continue
  }
  for (const form of rootForms(headingText)) sourceRootIdentities.add(rootIdentity(form))
}

for (const section of markup.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi)) {
  const rawHeading = textContent(section[2]).replace(/^构词成分[：:]?\s*/u, '').trim()
  const continuation = /（续）|\(续\)/.test(rawHeading)
  const root = rawHeading.replace(/（续）|\(续\)/g, '').replace(/\[[^\]]+]\s*$/, '').trim()
  if (!root || !isRootHeading(root)) continue

  const canonicalRoot = continuation
    ? rootForms(root).map((form) => canonicalRoots.get(rootIdentity(form))).find(Boolean) ?? root
    : root
  for (const form of rootForms(canonicalRoot)) {
    const identity = rootIdentity(form)
    if (identity && !canonicalRoots.has(identity)) canonicalRoots.set(identity, canonicalRoot)
  }

  const sourceAnchor = /\bid=["']([^"']+)["']/i.exec(section[1])?.[1] ?? ''
  for (const item of section[3].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    for (const clause of splitClauses(item[1])) {
      const componentMarker = /(?:其中|源自|来自|由)\s*/.exec(clause)
      const exampleMarkup = componentMarker ? clause.slice(0, componentMarker.index) : clause
      for (const match of exampleMarkup.matchAll(/<(em|code)\b[^>]*>([\s\S]*?)<\/\1>\s*(?:（[^）]{0,80}）\s*)?「/gi)) {
        const word = textContent(match[2]).toLocaleLowerCase('en-US')
        if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) continue
        const prefix = exampleMarkup.slice(0, match.index)
        const openParenthesis = Math.max(prefix.lastIndexOf('（'), prefix.lastIndexOf('('))
        const closeParenthesis = Math.max(prefix.lastIndexOf('）'), prefix.lastIndexOf(')'))
        if (openParenthesis > closeParenthesis) continue
        const precedingText = textContent(prefix)
        if (/(?:同义词|参见|复数|例如|如|与|同|见|比较|对照)[：:]?\s*$/i.test(precedingText)) continue
        candidates.push({ word, expectedRoot: canonicalRoot, sourceAnchor })
      }
    }
  }
}

const uniqueCandidates = [...new Map(candidates.map((candidate) => [
  `${candidate.word}\u0000${candidate.expectedRoot}\u0000${candidate.sourceAnchor}`,
  candidate
])).values()]

const englishIndex =
  /<article\b[^>]*id=["']letter-english-root-index["'][^>]*>([\s\S]*?)<\/article>/i.exec(markup)?.[1] ?? ''
const independentIndexCandidates: { word: string; expectedRoot: string }[] = []
for (const item of englishIndex.matchAll(
  /<li>\s*<strong>([\s\S]*?)<\/strong>\s*(?:（[^）]*）)?\s*[:：]\s*<code>([\s\S]*?)<\/code>\s*<\/li>/gi
)) {
  const word = textContent(item[1]).toLocaleLowerCase('en-US')
  if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) continue
  for (const expectedRoot of rootForms(textContent(item[2]))) {
    if (sourceRootIdentities.has(rootIdentity(expectedRoot))) independentIndexCandidates.push({ word, expectedRoot })
  }
}
const uniqueIndexCandidates = [...new Map(independentIndexCandidates.map((candidate) => [
  `${candidate.word}\u0000${rootIdentity(candidate.expectedRoot)}`,
  candidate
])).values()]
let state = 20260728
const random = (): number => {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let value = Math.imul(state ^ (state >>> 15), 1 | state)
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}
for (let index = uniqueCandidates.length - 1; index > 0; index -= 1) {
  const swapIndex = Math.floor(random() * (index + 1))
  ;[uniqueCandidates[index], uniqueCandidates[swapIndex]] = [uniqueCandidates[swapIndex], uniqueCandidates[index]]
}

const sample: typeof uniqueCandidates = []
const sampledWords = new Set<string>()
for (const candidate of uniqueCandidates) {
  if (sampledWords.has(candidate.word)) continue
  sample.push(candidate)
  sampledWords.add(candidate.word)
  if (sample.length === 100) break
}
assert.equal(sample.length, 100, `only found ${sample.length} independent dictionary examples`)

const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'shengciben-random-audit-'))
try {
  const indexer = new RootIndexer(cacheDirectory)
  const failures: { word: string; expectedRoot: string; sourceAnchor: string; actual: string[] }[] = []
  const results: { word: string; roots: string[] }[] = []
  for (const candidate of sample) {
    const matches = await indexer.match(candidate.word, dictionaryPath)
    const matchingSource = matches.some(
      (match) => match.root === candidate.expectedRoot && match.sourceAnchor === candidate.sourceAnchor
    )
    if (!matchingSource) {
      failures.push({
        ...candidate,
        actual: matches.map((match) => `${match.root}@${match.sourceAnchor}`)
      })
    }
    results.push({ word: candidate.word, roots: matches.map((match) => match.root) })
  }

  const indexSnapshot = JSON.parse(await readFile(path.join(cacheDirectory, 'root-index.json'), 'utf8')) as {
    entries: Record<string, unknown[]>
  }
  const globalWords = Object.keys(indexSnapshot.entries).filter((word) => /^[a-z][a-z'-]{2,}$/i.test(word))
  let globalState = 20260729
  const globalRandom = (): number => {
    globalState |= 0
    globalState = (globalState + 0x6d2b79f5) | 0
    let value = Math.imul(globalState ^ (globalState >>> 15), 1 | globalState)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  for (let index = globalWords.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(globalRandom() * (index + 1))
    ;[globalWords[index], globalWords[swapIndex]] = [globalWords[swapIndex], globalWords[index]]
  }

  let indexState = 20260730
  const indexRandom = (): number => {
    indexState |= 0
    indexState = (indexState + 0x6d2b79f5) | 0
    let value = Math.imul(indexState ^ (indexState >>> 15), 1 | indexState)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  for (let index = uniqueIndexCandidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(indexRandom() * (index + 1))
    ;[uniqueIndexCandidates[index], uniqueIndexCandidates[swapIndex]] = [
      uniqueIndexCandidates[swapIndex],
      uniqueIndexCandidates[index]
    ]
  }
  const indexSample = uniqueIndexCandidates.slice(0, 100)
  assert.equal(indexSample.length, 100, `only found ${indexSample.length} independent English-index examples`)
  const indexFailures: { word: string; expectedRoot: string; reason: string; actual: string[] }[] = []
  const indexResults: { word: string; expectedRoot: string; roots: string[] }[] = []
  for (const candidate of indexSample) {
    const matches = await indexer.match(candidate.word, dictionaryPath)
    const expectedIdentity = rootIdentity(candidate.expectedRoot)
    const matchingRoots = matches.filter((match) =>
      rootForms(match.root).some((form) => rootIdentity(form) === expectedIdentity)
    )
    if (!matchingRoots.length) {
      indexFailures.push({
        ...candidate,
        reason: 'expected English-index root missing',
        actual: matches.map((match) => `${match.root}@${match.sourceAnchor}`)
      })
    } else if (matchingRoots.every((match) => match.sourceAnchor === 'letter-english-root-index')) {
      indexFailures.push({
        ...candidate,
        reason: 'root matched only through the fallback English index',
        actual: matchingRoots.map((match) => `${match.root}@${match.sourceAnchor}`)
      })
    }
    indexResults.push({ ...candidate, roots: matches.map((match) => match.root) })
  }

  const canaries = {
    amateur: (await indexer.match('amateur', dictionaryPath)).map((match) => match.root),
    amiable: (await indexer.match('amiable', dictionaryPath)).map((match) => match.root),
    amble: (await indexer.match('amble', dictionaryPath)).map((match) => match.root),
    ambulance: (await indexer.match('ambulance', dictionaryPath)).map((match) => match.root),
    entertain: (await indexer.match('entertain', dictionaryPath)).map((match) => match.root),
    beguile: (await indexer.match('beguile', dictionaryPath)).map((match) => match.root),
    divert: (await indexer.match('divert', dictionaryPath)).map((match) => match.root),
    activate: (await indexer.match('activate', dictionaryPath)).map((match) => match.root),
    phose: (await indexer.match('phose', dictionaryPath)).map((match) => match.root),
    oppose: (await indexer.match('oppose', dictionaryPath)).map((match) => match.root),
    eruption: (await indexer.match('eruption', dictionaryPath)).map((match) => match.root),
    plant: (await indexer.match('plant', dictionaryPath)).map((match) => match.root),
    flect: (await indexer.match('flect', dictionaryPath)).map((match) => match.root),
    inter: (await indexer.match('inter', dictionaryPath)).map((match) => match.root),
    ex: (await indexer.match('ex', dictionaryPath)).map((match) => match.root),
    facere: (await indexer.match('facere', dictionaryPath)).map((match) => match.root),
    malus: (await indexer.match('malus', dictionaryPath)).map((match) => match.root),
    talk: (await indexer.match('talk', dictionaryPath)).map((match) => match.root),
    ambiversion: (await indexer.match('ambiversion', dictionaryPath)).map((match) => match.root),
    to: (await indexer.match('to', dictionaryPath)).map((match) => match.root),
    not: (await indexer.match('not', dictionaryPath)).map((match) => match.root),
    entreaty: (await indexer.match('entreaty', dictionaryPath)).map((match) => match.root),
    maltreat: (await indexer.match('maltreat', dictionaryPath)).map((match) => match.root),
    retreat: (await indexer.match('retreat', dictionaryPath)).map((match) => match.root),
    mis: (await indexer.match('mis', dictionaryPath)).map((match) => match.root),
    re: (await indexer.match('re', dictionaryPath)).map((match) => match.root)
  }
  assert.ok(canaries.amateur.includes('am'))
  assert.ok(canaries.amiable.includes('am'))
  assert.ok(canaries.amble.includes('amb'))
  assert.ok(canaries.ambulance.includes('amb'))
  assert.ok(canaries.entertain.includes('enter-'))
  assert.ok(!canaries.beguile.includes('enter-'))
  assert.ok(!canaries.divert.includes('enter-'))
  assert.ok(canaries.activate.some((root) => rootForms(root).some((form) => rootIdentity(form) === 'act')))
  assert.ok(canaries.phose.some((root) => rootForms(root).some((form) => rootIdentity(form) === 'phos')))
  assert.ok(canaries.oppose.includes('pon'))
  assert.ok(canaries.eruption.some((root) => rootForms(root).some((form) => rootIdentity(form) === 'rump')))
  assert.deepEqual(canaries.plant, ['plant'])
  assert.ok(!canaries.flect.some((root) => ['vertvers', 'viron'].includes(rootIdentity(root))))
  assert.deepEqual(canaries.inter, [])
  assert.deepEqual(canaries.ex, [])
  assert.deepEqual(canaries.facere, [])
  assert.ok(!canaries.malus.some((root) => ['tract', 'trib1'].includes(rootIdentity(root))))
  assert.ok(!canaries.talk.includes('S/T'))
  assert.equal(
    canaries.ambiversion.filter((root) => rootForms(root).some((form) => rootIdentity(form) === 'ambi')).length,
    1
  )
  assert.equal(new Set(canaries.to.map(rootIdentity)).size, canaries.to.length)
  assert.equal(new Set(canaries.not.map(rootIdentity)).size, canaries.not.length)
  assert.ok(canaries.entreaty.includes('tract'))
  assert.ok(canaries.maltreat.includes('tract'))
  assert.ok(canaries.retreat.includes('tract'))
  assert.ok(!canaries.mis.includes('tract'))
  assert.ok(!canaries.re.includes('tract'))
  const globalSample = globalWords.slice(0, 100)
  const sourceAnchors = new Set([...markup.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]))
  const globalFailures: { word: string; reason: string }[] = []
  const globalResults: { word: string; roots: string[] }[] = []
  for (const word of globalSample) {
    const matches = await indexer.match(word, dictionaryPath)
    if (!matches.length) globalFailures.push({ word, reason: 'no root matches' })
    if (matches.some((match) => !match.root || !match.sourceAnchor || !sourceAnchors.has(match.sourceAnchor))) {
      globalFailures.push({ word, reason: 'empty root or invalid source anchor' })
    }
    if (matches.some((match) => /^[A-Z]$/.test(match.root))) {
      globalFailures.push({ word, reason: 'letter chapter leaked as a root' })
    }
    if (matches.some((match) => rootForms(match.root).every((form) => /^[A-Z]$/.test(form)))) {
      globalFailures.push({ word, reason: 'composite letter column leaked as a root' })
    }
    const identities = matches.map((match) => rootIdentity(match.root))
    if (new Set(identities).size !== identities.length) globalFailures.push({ word, reason: 'duplicate root family' })
    globalResults.push({ word, roots: matches.map((match) => match.root) })
  }

  console.log(JSON.stringify({
    independentExamples: {
      seed: 20260728,
      candidatePool: uniqueCandidates.length,
      sampled: sample.length,
      passed: sample.length - failures.length,
      failed: failures.length,
      failures,
      samplePreview: results.slice(0, 10)
    },
    globalIndex: {
      seed: 20260729,
      candidatePool: globalWords.length,
      sampled: globalSample.length,
      passed: globalSample.length - globalFailures.length,
      failed: globalFailures.length,
      alphabetCoverage: [...new Set(globalSample.map((word) => word[0]))].sort().join(''),
      failures: globalFailures,
      samplePreview: globalResults.slice(0, 10)
    },
    independentEnglishIndex: {
      seed: 20260730,
      candidatePool: uniqueIndexCandidates.length,
      sampled: indexSample.length,
      passed: indexSample.length - indexFailures.length,
      failed: indexFailures.length,
      failures: indexFailures,
      samplePreview: indexResults.slice(0, 10)
    },
    canaries
  }, null, 2))
  if (failures.length || globalFailures.length || indexFailures.length) process.exitCode = 1
} finally {
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
  const resolvedCache = path.resolve(cacheDirectory)
  assert.ok(resolvedCache.startsWith(temporaryRoot), `refusing to remove non-temp path: ${resolvedCache}`)
  await rm(resolvedCache, { recursive: true, force: true })
}
