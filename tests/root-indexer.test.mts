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

test('AI morphemes resolve to dictionary families and keep unmatched affixes as AI analysis', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(dictionaryPath, [
    '<h2 id="root-con"><code>con-</code></h2>',
    '<ul><li><strong>核心词根义</strong>：共同、一起。</li></ul>',
    '<h2 id="root-vers"><code>vert / vers</code></h2>',
    '<ul><li><strong>核心词根义</strong>：转、转变。</li></ul>'
  ].join(''))
  const indexer = new RootIndexer(directory)

  const matches = await indexer.reconcile('conversion', [
    { kind: 'prefix', form: 'con-', canonicalForm: 'con-', meaning: '共同、一起' },
    { kind: 'root', form: 'vers', canonicalForm: 'vert / vers', meaning: '转、转变' },
    { kind: 'suffix', form: '-ion', canonicalForm: '-ion', meaning: '动作、过程或结果' }
  ], dictionaryPath)

  assert.deepEqual(matches.map((match) => ({
    root: match.root,
    surfaceForm: match.surfaceForm,
    kind: match.kind,
    meaning: match.meaning,
    source: match.source,
    sourceAnchor: match.sourceAnchor,
    matchedVia: match.matchedVia,
    sortOrder: match.sortOrder
  })), [
    { root: 'con-', surfaceForm: 'con-', kind: 'prefix', meaning: '共同、一起。', source: 'dictionary', sourceAnchor: 'root-con', matchedVia: 'morpheme', sortOrder: 0 },
    { root: 'vert / vers', surfaceForm: 'vers', kind: 'root', meaning: '转、转变。', source: 'dictionary', sourceAnchor: 'root-vers', matchedVia: 'morpheme', sortOrder: 1 },
    { root: '-ion', surfaceForm: '-ion', kind: 'suffix', meaning: '动作、过程或结果', source: 'ai', sourceAnchor: '', matchedVia: 'ai', sortOrder: 2 }
  ])
})

test('AI morphemes collapse duplicate forms from the same dictionary family', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(dictionaryPath, [
    '<h2 id="root-con"><code>com- / con- / co-</code></h2>',
    '<ul><li><strong>核心词根义</strong>：共同、一起。</li></ul>'
  ].join(''))
  const indexer = new RootIndexer(directory)

  const matches = await indexer.reconcile('connect', [
    { kind: 'prefix', form: 'con-', canonicalForm: 'con-', meaning: '共同、一起' },
    { kind: 'prefix', form: 'con', canonicalForm: 'com- / con- / co-', meaning: '共同、一起' }
  ], dictionaryPath)

  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.root, 'com- / con- / co-')
  assert.equal(matches[0]?.source, 'dictionary')
})

test('root index covers dictionary section variants without indexing gloss components', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-vas"><code>vas</code></h2>',
      '<ul>',
      '<li><strong>简单词根</strong>：<em>vascular</em>「血管的」。</li>',
      '<li><strong>首位词根复合</strong>：<em>vasodilator</em>「血管扩张剂」（<em>dis</em>「分开」+ <em>latus</em>「宽」）。</li>',
      '<li><strong>法语</strong>：<em>vase</em>「花瓶」。</li>',
      '<li><strong><code>ad:</code></strong>：仅为构词说明。</li>',
      '</ul>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)

  assert.equal((await indexer.match('vascular', dictionaryPath))[0]?.root, 'vas')
  assert.equal((await indexer.match('vasodilator', dictionaryPath))[0]?.root, 'vas')
  assert.equal((await indexer.match('vase', dictionaryPath))[0]?.root, 'vas')
  assert.deepEqual(await indexer.match('latus', dictionaryPath), [])
  assert.deepEqual(await indexer.match('ad', dictionaryPath), [])
})

test('root index reads every parallel code headword before the definition', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-act"><code>act</code></h2>',
      '<ul>',
      '<li><code>activate</code>、<code>activator</code>、<code>activist</code>、<code>active</code>。</li>',
      '<li><code>actualize</code>（使成为现实）、<code>actuality</code>（现实）。</li>',
      '<li><code>actor</code>、<code>actress</code>（源自 <code>agere</code>“做”）。</li>',
      '<li><strong>Examples（例词）</strong>：<code>action</code>、<code>actual</code>。</li>',
      '</ul>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)

  for (const word of [
    'activate',
    'activator',
    'activist',
    'active',
    'actualize',
    'actuality',
    'actor',
    'actress',
    'action',
    'actual'
  ]) {
    assert.equal((await indexer.match(word, dictionaryPath))[0]?.root, 'act', word)
  }
  assert.deepEqual(await indexer.match('agere', dictionaryPath), [])
})

test('root index handles annotated headings, nested components, and cross-reference sections', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-phos"><code>phos</code>、<code>phot</code>（希腊语 <code>phos</code>：光）</h2>',
      '<ul><li><strong>核心词根义</strong>：光。</li>',
      '<li><p><code>phose</code>、<code>photic</code>：与光有关。</p></li></ul>',
      '<h3>交叉参见</h3><ul><li><code>plant</code>、<code>blast</code></li></ul>',
      '<h2 id="root-rump"><code>rump</code>（续）[to break，打破]</h2>',
      '<ul>',
      '<li><code>erupt</code>、<code>eruption</code>、<code>eruptive</code><ul><li><code>ex</code>：向外</li></ul></li>',
      '<li><code>incorrupt</code>、<code>incorruptible</code><ul><li><code>in</code>：不</li></ul></li>',
      '<li><code>interrupted</code>（被打断的）、<code>interruption</code><ul><li><code>inter</code>：在……之间</li></ul></li>',
      '<li><code>intertribal</code>；<code>inter</code>（在……之间）</li>',
      '<li><code>maldistribution</code>（分配不良）；<code>malus</code>（坏）</li>',
      '<li><code>nidify</code>（筑巢） <code>facere</code>（制作）</li>',
      '</ul>',
      '<h2 id="root-auto">auto-：self（自身）</h2>',
      '<ul><li><strong>核心词根义（Meaning）</strong>：self（自身）。</li>',
      '<li><strong>例词（Examples）</strong>：<strong>autism</strong>、<strong>autobiography</strong></li></ul>',
      '<h2 id="root-tract"><code>tract</code></h2>',
      '<ul><li><code>treat</code>：<code>entreat</code>（恳求）；<code>entreaty</code>；<code>en</code>（使）；',
      '<code>estreat</code>；<code>ex</code>（向外）；<code>maltreat</code>；<code>maltreatment</code>；',
      '<code>malus</code>（坏）；<code>mistreat</code>；<code>retreat</code>；<code>re</code>（向后）</li></ul>',
      '<article id="letter-english-root-index"><h3>S/T（第二栏）</h3><ul>',
      '<li><code>talk</code>、<code>water</code></li>',
      '<li><strong>self</strong>：<code>auto-</code></li></ul></article>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)

  assert.deepEqual((await indexer.match('phose', dictionaryPath)).map((match) => match.root), ['phos、phot'])
  assert.equal((await indexer.match('eruption', dictionaryPath))[0]?.root, 'rump')
  assert.equal((await indexer.match('incorruptible', dictionaryPath))[0]?.root, 'rump')
  assert.equal((await indexer.match('interruption', dictionaryPath))[0]?.root, 'rump')
  assert.equal((await indexer.match('autism', dictionaryPath))[0]?.root, 'auto-')
  assert.equal((await indexer.match('self', dictionaryPath))[0]?.sourceAnchor, 'root-auto')
  for (const word of ['entreat', 'entreaty', 'estreat', 'maltreat', 'maltreatment', 'mistreat', 'retreat']) {
    assert.equal((await indexer.match(word, dictionaryPath))[0]?.root, 'tract', word)
  }
  for (const component of ['plant', 'blast', 'ex', 'in', 'inter', 'malus', 'facere', 'talk', 'water']) {
    assert.deepEqual(await indexer.match(component, dictionaryPath), [], component)
  }
})

test('root index isolates sentences, contextual mentions, and duplicate family entries', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-vers"><code>vert / vers</code></h2>',
      '<ul><li><strong>基础词根</strong>：<em>verso</em>「左页」。</li></ul>',
      '<h2 id="root-vers-continuation"><code>vert（续）[转、弯]</code></h2>',
      '<ul><li><strong>词根复合</strong>：<em>verso</em>「书页背面」；<em>versify</em>「作诗」，其中 <em>facere</em>「制造」。<em>verticillaster</em>「轮伞花序」，其中 <em>aster</em>「星」。</li></ul>',
      '<h2 id="root-aster"><code>aster</code></h2>',
      '<ul><li><strong>核心词根义</strong>：star（星）</li></ul>',
      '<h2 id="root-var"><code>var</code></h2>',
      '<ul><li><strong>跨学科 VARIABLE</strong>：表示可变值，与 <em>constant</em>「常量」相对。</li></ul>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)
  const versoMatches = await indexer.match('verso', dictionaryPath)
  const versifyMatches = await indexer.match('versify', dictionaryPath)

  assert.equal(versoMatches.filter((match) => match.root === 'vert / vers').length, 1)
  assert.deepEqual(versifyMatches.map((match) => match.root), ['vert / vers'])
  assert.deepEqual(await indexer.match('constant', dictionaryPath), [])
})

test('root index skips letter chapters and reads legacy h3 root sections', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="letter-n">N</h2>',
      '<h3 id="root-narc"><code>narc</code></h3>',
      '<ul>',
      '<li><strong>词义</strong>：stupor（昏迷）</li>',
      '<li><strong>SIMPLE ROOT（基础词）</strong><ul>',
      '<li><strong>narcotic</strong>, <strong>narcotine</strong></li>',
      '<li><strong>noticeable</strong>（同义词：<strong>remarkable</strong>）</li>',
      '</ul></li>',
      '</ul>',
      '<h3 id="root-narr"><code>narr</code></h3>',
      '<ul><li><strong>SIMPLE ROOT（基础词）</strong><ul><li><strong>narrate</strong>（讲述）</li></ul></li></ul>',
      '<h3 id="root-mun"><code>mun</code></h3>',
      '<ul><li><strong>词义</strong>：community（共同体）</li></ul>',
      '<h2 id="root-muti"><code>muti</code></h2>',
      '<h3 id="muti-examples">基础词</h3>',
      '<ul><li><code>mutilate</code>：使残缺。</li></ul>',
      '<h3 id="root-myo"><code>myo</code></h3>',
      '<ul><li><strong>SIMPLE ROOT（基础词）</strong><ul><li><strong>myocarditis</strong>（心肌炎）</li></ul></li></ul>',
      '<h3 id="root-tub">tub2——[Latin to swell up, lump]</h3>',
      '<h4>前缀派生词</h4><ul><li><strong>protuberance</strong>（凸起）</li></ul>',
      '<h2 id="appendix">附录</h2>',
      '<article id="letter-english-root-index"><ul><li><strong>community</strong>：<code>C, mun</code></li></ul></article>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)
  const narcoticMatches = await indexer.match('narcotic', dictionaryPath)

  assert.equal(narcoticMatches[0]?.root, 'narc')
  assert.equal(narcoticMatches[0]?.sourceAnchor, 'root-narc')
  assert.equal((await indexer.match('narrate', dictionaryPath))[0]?.root, 'narr')
  assert.ok((await indexer.match('noticeable', dictionaryPath)).every((match) => match.root !== 'N'))
  assert.deepEqual(await indexer.match('remarkable', dictionaryPath), [])
  assert.deepEqual((await indexer.match('community', dictionaryPath)).map((match) => match.root), ['mun'])
  assert.deepEqual((await indexer.match('myocarditis', dictionaryPath)).map((match) => match.root), ['myo'])
  assert.deepEqual((await indexer.match('protuberance', dictionaryPath)).map((match) => match.root), ['tub2'])
})

test('root index reads single-dash headings and ignores strong synonym references', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="letter-a">A</h2>',
      '<h3 id="root-am">am — to love; friend（爱；朋友）</h3>',
      '<ul><li><strong>核心词根义（Meaning）</strong>：to love; friend（爱；朋友）。</li>',
      '<li><strong>基础词（SIMPLE ROOT）</strong><ul>',
      '<li><strong>amateur</strong>：业余爱好者。</li>',
      '<li><strong>amiable</strong>：同义词：<strong>affable</strong>、<strong>obliging</strong>。</li>',
      '</ul></li></ul>',
      '<h3 id="root-amnio">amnio — amnion（羊膜）</h3>',
      '<ul><li><strong>amniotic</strong>：羊膜的。</li></ul>',
      '<h3 id="root-amoeb">amoeb（亦拼作 ameb）— to change（改变）</h3>',
      '<ul><li><strong>amoeba</strong>：变形虫。</li><li><strong>amoebic</strong>：变形虫的。</li></ul>',
      '<h2 id="root-enter"><code>enter-</code></h2>',
      '<h3>前缀派生词</h3>',
      '<ul><li><strong>entertain</strong>：近义词：<strong>amuse</strong>、<strong>beguile</strong>、<strong>divert</strong>。（<code>tenere</code> 持有）</li></ul>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)

  const amateurMatch = (await indexer.match('amateur', dictionaryPath))[0]
  assert.equal(amateurMatch?.root, 'am')
  assert.match(amateurMatch?.meaning ?? '', /to love/)
  assert.equal((await indexer.match('amiable', dictionaryPath))[0]?.sourceAnchor, 'root-am')
  assert.deepEqual((await indexer.match('amoeba', dictionaryPath)).map((match) => match.root), ['amoeb / ameb'])
  assert.ok((await indexer.match('amoebic', dictionaryPath)).every((match) => match.root !== 'amnio'))
  assert.equal((await indexer.match('entertain', dictionaryPath))[0]?.root, 'enter-')
  assert.deepEqual(await indexer.match('affable', dictionaryPath), [])
  assert.deepEqual(await indexer.match('amuse', dictionaryPath), [])
  assert.deepEqual(await indexer.match('beguile', dictionaryPath), [])
  assert.deepEqual(await indexer.match('divert', dictionaryPath), [])
})

test('root index does not leak inline root families into the preceding h2 section', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-gen"><code>gen</code></h2>',
      '<ul><li><code>genesis</code>：起源。</li></ul>',
      '<p><strong>gyr</strong>　希腊语“圆、旋转”</p>',
      '<p><strong>gyros</strong>　圆</p>',
      '<ul><li><strong>gyration</strong>（旋转）</li></ul>',
      '<h2 id="root-fresc"><code>fresc、fresco</code></h2>',
      '<ul><li><code>fresco</code>：湿壁画。</li></ul>',
      '<p><strong>fri(c)、fricare</strong>　拉丁语“摩擦”</p>',
      '<ul><li><strong>friction</strong>：摩擦。</li><li><strong>fricative</strong>：摩擦音。</li></ul>',
      '<h2 id="appendix">附录</h2>',
      '<article id="letter-english-root-index"><ul><li><strong>gyration</strong>：<code>gyr</code></li></ul></article>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)

  assert.equal((await indexer.match('genesis', dictionaryPath))[0]?.root, 'gen')
  assert.deepEqual((await indexer.match('gyration', dictionaryPath)).map((match) => match.root), ['gyr'])
  const frictionRoots = (await indexer.match('friction', dictionaryPath)).map((match) => match.root)
  assert.ok(frictionRoots.includes('fric / fri、fricare'))
  assert.ok(!frictionRoots.includes('fresc、fresco'))
})

test('root matches collapse abbreviated forms from the same root family and source', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(
    dictionaryPath,
    [
      '<h2 id="root-ambi"><code>ambi, ambo, amb, an</code></h2>',
      '<ul><li><strong>核心词根义</strong>：around（周围）。</li>',
      '<li><strong>例词</strong>：<em>ambiversion</em>「中间性格」，其中 <em>ambi</em>「两侧」。</li></ul>',
      '<h2 id="root-a1"><code>a-1</code></h2>',
      '<ul><li><strong>核心词根义</strong>：to, toward（向）。</li><li><code>toward</code>：向。</li></ul>',
      '<article id="letter-english-root-index"><ul><li><strong>toward</strong>：<code>a1</code></li></ul></article>'
    ].join(''),
    'utf8'
  )

  const indexer = new RootIndexer(directory)
  const matches = await indexer.match('ambiversion', dictionaryPath)

  assert.deepEqual(matches.map((match) => match.root), ['ambi, ambo, amb, an'])
  assert.deepEqual((await indexer.match('toward', dictionaryPath)).map((match) => match.root), ['a-1'])
})

test('reconcile 拦截不在单词中的 AI 幻觉词素（similar 案例）', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(dictionaryPath, [
    '<h2 id="root-simil"><code>simil</code></h2>',
    '<ul><li><strong>核心词根义</strong>：相似、相同。</li></ul>'
  ].join(''))
  const indexer = new RootIndexer(directory)

  const matches = await indexer.reconcile('similar', [
    { kind: 'root', form: 'simil', canonicalForm: 'simil', meaning: '相似、相同' },
    { kind: 'suffix', form: '-ar', canonicalForm: '-ar', meaning: '形容词后缀' },
    { kind: 'root', form: 'homo', canonicalForm: 'homo', meaning: '相同' },
    { kind: 'root', form: 'idem', canonicalForm: 'idem', meaning: '相同' },
    { kind: 'root', form: 'iso', canonicalForm: 'iso', meaning: '相同' },
    { kind: 'root', form: 'taut', canonicalForm: 'taut', meaning: '相同' }
  ], dictionaryPath)

  assert.deepEqual(matches.map((match) => match.surfaceForm), ['simil', '-ar'])
})

test('reconcile 形态校验：全部幻觉词素时返回空', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(dictionaryPath, '<h2 id="root-x"><code>xyz</code></h2>')
  const indexer = new RootIndexer(directory)

  const matches = await indexer.reconcile('apple', [
    { kind: 'root', form: 'homo', canonicalForm: 'homo', meaning: '相同' },
    { kind: 'root', form: 'iso', canonicalForm: 'iso', meaning: '相同' }
  ], dictionaryPath)

  assert.equal(matches.length, 0)
})

test('reconcile 形态校验：大小写与带连字符形式均可通过', async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-roots-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const dictionaryPath = path.join(directory, 'roots.html')
  writeFileSync(dictionaryPath, [
    '<h2 id="root-con"><code>con-</code></h2>',
    '<ul><li><strong>核心词根义</strong>：共同、一起。</li></ul>'
  ].join(''))
  const indexer = new RootIndexer(directory)

  const matches = await indexer.reconcile('Connect', [
    { kind: 'prefix', form: 'Con-', canonicalForm: 'con-', meaning: '共同' }
  ], dictionaryPath)

  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.surfaceForm, 'Con-')
})
