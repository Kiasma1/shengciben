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

test('root index recognizes emphasized examples and their referenced prefixes', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="prefix-con"><code>con-</code></h2>',
      '<ul><li><strong>核心词根义</strong>：together（共同）</li><li><code>connect</code>：连接。</li></ul>',
      '<h2 id="root-vers"><code>vert / vers</code></h2>',
      '<p>拉丁语 <em>vertere</em>「转、弯」。</p>',
      '<h2 id="root-vers-continuation"><code>vert（续）[转、弯]</code></h2>',
      '<ul><li><strong>vers- 加前缀词根</strong>：<em>converse</em>（名词）「交谈」（同义词：<em>talk</em>）；<em>conversion</em>「转换」，其中 <em>con</em>「共同」。</li></ul>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)
  const matches = await indexer.match('conversion', dictionaryPath)
  const roots = matches.map((match) => match.root)

  assert.ok(roots.includes('con-'), `expected con- in ${JSON.stringify(roots)}`)
  assert.ok(roots.includes('vert / vers'), `expected vert / vers in ${JSON.stringify(roots)}`)
  assert.equal(matches.find((match) => match.root === 'vert / vers')?.sourceAnchor, 'root-vers-continuation')
  assert.deepEqual(await indexer.match('talk', dictionaryPath), [])
})
