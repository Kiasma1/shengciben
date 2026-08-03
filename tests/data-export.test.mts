import assert from 'node:assert/strict'
import test from 'node:test'
import { wordsToCsv } from '../src/main/data-export.ts'

test('CSV export preserves Chinese text and escapes quotes', () => {
  const csv = wordsToCsv([
    {
      id: 'word-1',
      word: 'quote',
      normalizedWord: 'quote',
      ipaUk: 'kwəʊt',
      senses: [{ partOfSpeech: 'verb', definitionZh: '"引用", 引述' }],
      categoryId: 'category-1',
      categoryName: '写作',
      categoryColor: '#000000',
      tags: [{ id: 'tag-1', name: '考试' }],
      aiMorphemes: [],
      formationSummary: '',
      rootMatches: [{
        root: 'quot',
        surfaceForm: 'quot',
        kind: 'root',
        meaning: 'how many',
        formationNote: '来自拉丁语',
        source: 'dictionary',
        sourceAnchor: 'quot',
        sourceLabel: '词根 quot',
        matchedVia: 'exact',
        sortOrder: 0
      }],
      status: 'ready',
      aiError: null,
      isDeleted: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ])

  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"verb: ""引用"", 引述"'))
  assert.match(csv, /"来自拉丁语"/)
  assert.doesNotMatch(csv, /已核对/)
})
