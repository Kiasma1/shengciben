import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { lemmaCandidates, RootIndexer } from '../src/main/root-indexer.ts'

test('lemma fallback collapses doubled consonants', () => {
  assert.ok(lemmaCandidates('running').includes('run'))
  assert.ok(lemmaCandidates('stopped').includes('stop'))
  assert.ok(lemmaCandidates('studied').includes('study'))
})

test('root index keeps the dictionary formation note for each example', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    '<h2 id="root-voc"><code>voc</code></h2><ul><li><strong>核心词根义</strong>：voice（声音）</li><li><code>vocabulary</code>：词汇；由 voc（声音）构成。</li></ul>',
    'utf8'
  )

  const indexer = new RootIndexer(directory)
  const matches = await indexer.match('vocabulary', dictionaryPath)

  assert.equal(matches[0]?.root, 'voc')
  assert.match(matches[0]?.formationNote ?? '', /由 voc/)
})
