import assert from 'node:assert/strict'
import test from 'node:test'
import { wordsToCsv } from '../src/main/data-export.ts'

test('CSV export preserves Chinese text and escapes quotes', () => {
  const csv = wordsToCsv([
    {
      id: 'word-1',
      word: 'quote',
      normalizedWord: 'quote',
      entryType: 'word',
      phraseType: '',
      phraseComponents: [],
      phraseExplanation: '',
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
  assert.match(csv, /entry_type/)
  assert.ok(csv.includes('"verb: ""引用"", 引述"'))
  assert.match(csv, /"来自拉丁语"/)
  assert.doesNotMatch(csv, /已核对/)
})

test('CSV export includes phrase fields without changing word rows', () => {
  const csv = wordsToCsv([{
    id: 'phrase-1', word: 'welfare check', normalizedWord: 'welfare check', entryType: 'phrase', phraseType: 'noun phrase',
    phraseComponents: [{ text: 'welfare', meaningZh: '安全状况' }, { text: 'check', meaningZh: '确认' }],
    phraseExplanation: '整体表达说明', ipaUk: 'ˈwelfeə tʃek', senses: [{ partOfSpeech: 'noun phrase', definitionZh: '安危检查' }],
    categoryId: 'category-1', categoryName: '表达', categoryColor: '#000000', tags: [], aiMorphemes: [], formationSummary: '', rootMatches: [],
    status: 'ready', aiError: null, isDeleted: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    lastReviewedAt: null, reviewCount: 0, nextReviewAt: null
  }])
  assert.match(csv, /"phrase"/)
  assert.match(csv, /"noun phrase"/)
  assert.match(csv, /"welfare: 安全状况 \| check: 确认"/)
  assert.match(csv, /"整体表达说明"/)
})
