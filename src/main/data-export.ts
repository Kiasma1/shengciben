import type { WordEntry } from '../shared/types'

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`

export function wordsToCsv(words: WordEntry[]): string {
  const headers = ['单词', 'entry_type', 'phrase_type', 'phrase_components', 'phrase_explanation', '英式 IPA', '词性与中文释义', '分类', '标签', '词根', '词根义', '构词说明', 'AI 状态']
  const rows = words.map((entry) => [
    entry.word,
    entry.entryType ?? 'word',
    entry.phraseType ?? '',
    (entry.phraseComponents ?? []).map((component) => `${component.text}: ${component.meaningZh}`).join(' | '),
    entry.phraseExplanation ?? '',
    entry.ipaUk,
    entry.senses.map((sense) => `${sense.partOfSpeech}: ${sense.definitionZh}`).join('；'),
    entry.categoryName,
    entry.tags.map((tag) => tag.name).join('；'),
    entry.rootMatches.map((match) => match.root).join('；'),
    entry.rootMatches.map((match) => match.meaning).join('；'),
    entry.rootMatches.map((match) => match.formationNote).filter(Boolean).join('；'),
    entry.status
  ])
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
