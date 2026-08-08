import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { localPhraseHint, localPhrasePrompt } from '../src/main/local-provider.ts'

interface BlindPhraseCase {
  id: number
  phrase: string
  referenceMeaningZh: string
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetContent = readFileSync(path.join(repositoryRoot, 'evaluations', 'phrase-blind-v1.json'), 'utf8')
const dataset = JSON.parse(datasetContent) as BlindPhraseCase[]

test('phrase blind evaluation contains 50 unique cases outside the prompt and safety set', () => {
  assert.equal(dataset.length, 50)
  assert.equal(new Set(dataset.map((item) => item.phrase.toLocaleLowerCase('en-US'))).size, 50)
  for (const item of dataset) {
    assert.equal(localPhrasePrompt.toLocaleLowerCase('en-US').includes(item.phrase.toLocaleLowerCase('en-US')), false, item.phrase)
    assert.equal(localPhraseHint(item.phrase), null, item.phrase)
  }
})

test('phrase blind scores cover the frozen raw results exactly once', () => {
  const rawResultContent = readFileSync(path.join(repositoryRoot, 'evaluations', 'results', 'phrase-blind-v1-qwen3-0.6b-q8_0.json'), 'utf8')
  const rawResults = JSON.parse(rawResultContent) as {
    datasetSha256: string
    promptSha256: string
    promptIncludedReferences: boolean
    results: Array<{ id: number; phrase: string; referenceMeaningZh: string }>
  }
  const scoreDocument = JSON.parse(readFileSync(path.join(repositoryRoot, 'evaluations', 'results', 'phrase-blind-v1-scores.json'), 'utf8')) as {
    rawResultSha256: string
    scores: Array<{ id: number; rating: string }>
  }
  const allowedRatings = new Set(['correct', 'usable', 'literal', 'wrong'])
  const expectedIds = dataset.map((item) => item.id).sort((left, right) => left - right)
  const expectedCases = dataset.map(({ id, phrase, referenceMeaningZh }) => ({ id, phrase, referenceMeaningZh }))
  const ratingCounts = Object.fromEntries([...allowedRatings].map((rating) => [
    rating,
    scoreDocument.scores.filter((score) => score.rating === rating).length
  ]))

  assert.equal(rawResults.datasetSha256, createHash('sha256').update(datasetContent).digest('hex'))
  assert.equal(rawResults.promptSha256, createHash('sha256').update(localPhrasePrompt).digest('hex'))
  assert.equal(rawResults.promptIncludedReferences, false)
  assert.equal(createHash('sha256').update(rawResultContent).digest('hex'), scoreDocument.rawResultSha256)
  assert.deepEqual(rawResults.results.map((item) => item.id).sort((left, right) => left - right), expectedIds)
  assert.deepEqual(rawResults.results.map(({ id, phrase, referenceMeaningZh }) => ({ id, phrase, referenceMeaningZh })), expectedCases)
  assert.deepEqual(scoreDocument.scores.map((item) => item.id).sort((left, right) => left - right), expectedIds)
  assert.equal(scoreDocument.scores.every((item) => allowedRatings.has(item.rating)), true)
  assert.deepEqual(ratingCounts, { correct: 9, usable: 14, literal: 13, wrong: 14 })
})
