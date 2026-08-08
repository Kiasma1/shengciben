import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalAiService } from '../src/main/local-ai.ts'
import { LocalAiProvider, localPhrasePrompt } from '../src/main/local-provider.ts'
import type { AppSettings } from '../src/shared/types.ts'

interface BlindPhraseCase {
  id: number
  phrase: string
  referenceMeaningZh: string
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetPath = path.join(repositoryRoot, 'evaluations', 'phrase-blind-v1.json')
const outputDirectory = path.join(repositoryRoot, 'evaluations', 'results')
const outputPath = path.join(outputDirectory, 'phrase-blind-v1-qwen3-0.6b-q8_0.json')
const datasetContent = readFileSync(datasetPath, 'utf8')
const cases = JSON.parse(datasetContent) as BlindPhraseCase[]
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const datasetSha256 = sha256(datasetContent)
const promptSha256 = sha256(localPhrasePrompt)
const settings: AppSettings = {
  aiProvider: 'local',
  deepseekApiUrl: '',
  deepseekModel: '',
  deepseekApiKey: '',
  dictionaryPath: '',
  dailyNewLimit: 20
}

const service = new LocalAiService({
  resourceContext: { appPath: repositoryRoot, isPackaged: false },
  requestTimeoutMs: 180_000
})
const provider = new LocalAiProvider(service)
let startedAt = new Date().toISOString()
let results: Array<Record<string, unknown>> = []
if (existsSync(outputPath)) {
  const previous = JSON.parse(readFileSync(outputPath, 'utf8')) as {
    startedAt?: string
    datasetSha256?: string
    promptSha256?: string
    results?: Array<Record<string, unknown>>
  }
  if (previous.datasetSha256 === datasetSha256 && previous.promptSha256 === promptSha256 && Array.isArray(previous.results)) {
    startedAt = previous.startedAt ?? startedAt
    results = previous.results
  }
}

const persist = (): void => {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify({
    evaluation: 'phrase-blind-v1',
    model: 'Qwen3-0.6B-Q8_0',
    startedAt,
    updatedAt: new Date().toISOString(),
    datasetSha256,
    promptSha256,
    promptIncludedReferences: false,
    results
  }, null, 2)}\n`, 'utf8')
}

try {
  await service.start()
  for (const item of cases) {
    if (results.some((result) => result.id === item.id)) continue
    const startedAt = Date.now()
    try {
      const output = await provider.enrich({
        settings,
        word: item.phrase,
        entryType: 'phrase',
        existingCategories: []
      })
      results.push({ ...item, durationMs: Date.now() - startedAt, output })
      console.log(`[${item.id}/${cases.length}] ${item.phrase}: ${output.senses.map((sense) => sense.definitionZh).join('；')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ ...item, durationMs: Date.now() - startedAt, error: message })
      console.error(`[${item.id}/${cases.length}] ${item.phrase}: ERROR ${message}`)
    }
    persist()
  }
} finally {
  service.stop()
}

const failures = results.filter((result) => 'error' in result).length
console.log(`Saved ${results.length} results (${failures} errors) to ${outputPath}`)
