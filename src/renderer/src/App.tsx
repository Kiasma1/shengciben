import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  ArchiveRestore,
  BookOpen,
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  FileDown,
  FolderPlus,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import type {
  AppSettings,
  Category,
  EnrichmentStatus,
  ExportFormat,
  OllamaStatus,
  QueueStatus,
  RootIndexStatus,
  WordCreateResult,
  WordDraft,
  WordEntry,
  WordSense
} from '../../shared/types'

type CollectionView = 'active' | 'trash'
type Toast = { kind: 'success' | 'error'; message: string } | null
type ToastKind = 'success' | 'error'

const CATEGORY_COLORS = ['#8a6b42', '#3d6b65', '#5567a4', '#9d5b6e', '#8d7048', '#527ba0']

const statusCopy: Record<EnrichmentStatus, string> = {
  pending: '待 AI 处理',
  processing: 'AI 处理中',
  needs_review: '待核对',
  ready: '已核对',
  failed: '处理失败'
}

const statusTone: Record<EnrichmentStatus, string> = {
  pending: 'muted',
  processing: 'processing',
  needs_review: 'review',
  ready: 'ready',
  failed: 'failed'
}

const blankSense = (): WordSense => ({ partOfSpeech: '', definitionZh: '' })

export default function App(): ReactElement {
  const [entries, setEntries] = useState<WordEntry[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<EnrichmentStatus | 'all'>('all')
  const [sort, setSort] = useState<'recent' | 'alphabetical'>('recent')
  const [collectionView, setCollectionView] = useState<CollectionView>('active')
  const [isLoading, setIsLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ pending: 0, processing: 0, failed: 0, paused: false })

  const filters = useMemo(
    () => ({
      query,
      categoryId: selectedCategoryId,
      status: statusFilter,
      sort,
      includeDeleted: collectionView === 'trash'
    }),
    [collectionView, query, selectedCategoryId, sort, statusFilter]
  )

  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null

  const load = async (): Promise<void> => {
    try {
      const [nextEntries, nextCategories, nextQueueStatus] = await Promise.all([
        window.api.words.list(filters),
        window.api.categories.list(),
        window.api.queue.status()
      ])
      setEntries(nextEntries)
      setCategories(nextCategories)
      setQueueStatus(nextQueueStatus)
      setSelectedId((current) => (current && nextEntries.some((entry) => entry.id === current) ? current : nextEntries[0]?.id ?? null))
    } catch (error) {
      showToast('error', messageOf(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [filters])

  useEffect(() => {
    const unsubscribe = window.api.onWordsChanged(() => void load())
    return unsubscribe
  }, [filters])

  const showToast = (kind: ToastKind, message: string): void => {
    setToast({ kind, message })
    window.setTimeout(() => setToast(null), 3600)
  }

  const createCategory = async (): Promise<void> => {
    const name = window.prompt('新分类名称')?.trim()
    if (!name) return
    try {
      const category = await window.api.categories.create(name, CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length])
      setSelectedCategoryId(category.id)
      showToast('success', `已创建分类「${category.name}」。`)
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const removeCategory = async (category: Category): Promise<void> => {
    if (!window.confirm(`删除分类「${category.name}」？其中的单词将移到“未分类”。`)) return
    try {
      await window.api.categories.delete(category.id)
      if (selectedCategoryId === category.id) setSelectedCategoryId(null)
      showToast('success', '分类已删除。')
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const toggleQueue = async (): Promise<void> => {
    try {
      setQueueStatus(await window.api.queue.setPaused(!queueStatus.paused))
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  return (
    <main className="app-shell">
      <Sidebar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        collectionView={collectionView}
        onSelectCategory={(id) => {
          setCollectionView('active')
          setSelectedCategoryId(id)
        }}
        onShowAll={() => {
          setCollectionView('active')
          setSelectedCategoryId(null)
        }}
        onShowTrash={() => {
          setCollectionView('trash')
          setSelectedCategoryId(null)
        }}
        onCreateCategory={() => void createCategory()}
        onDeleteCategory={(category) => void removeCategory(category)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <section className="word-column" aria-label="单词列表">
        <header className="list-header">
          <div className="word-search">
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词、释义、标签或词根" aria-label="搜索单词" />
            {query && (
              <button className="icon-button" onClick={() => setQuery('')} aria-label="清除搜索">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="list-controls">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as EnrichmentStatus | 'all')} aria-label="按处理状态筛选">
              <option value="all">全部状态</option>
              <option value="pending">待 AI 处理</option>
              <option value="processing">AI 处理中</option>
              <option value="needs_review">待核对</option>
              <option value="ready">已核对</option>
              <option value="failed">处理失败</option>
            </select>
            <button className="text-button" onClick={() => setSort((value) => (value === 'recent' ? 'alphabetical' : 'recent'))}>
              {sort === 'recent' ? '最近更新' : 'A–Z'}
            </button>
          </div>
        </header>

        <div className="list-summary">
          <span>{collectionView === 'trash' ? '回收站' : selectedCategoryId ? '已筛选' : '全部单词'}</span>
          <span>{entries.length} 个条目</span>
        </div>

        <div className="word-list">
          {isLoading ? <ListLoading /> : entries.length ? entries.map((entry) => <WordRow key={entry.id} entry={entry} selected={entry.id === selected?.id} onClick={() => setSelectedId(entry.id)} />) : <ListEmpty view={collectionView} query={query} />}
        </div>
      </section>

      <section className="detail-column" aria-label="单词详情">
        <header className="detail-header">
          <div>
            <p className="eyebrow">个人词库</p>
            <h1>{selected ? selected.word : '生词本'}</h1>
          </div>
          <div className="header-actions">
            <div className={`queue-control ${queueStatus.paused ? 'paused' : ''}`}>
              <span>
                {queueStatus.paused
                  ? `AI 已暂停 · ${queueStatus.pending} 项待处理`
                  : queueStatus.processing
                    ? `AI 处理中 · ${queueStatus.pending} 项等待`
                    : queueStatus.pending
                      ? `${queueStatus.pending} 项等待 AI`
                      : 'AI 队列空闲'}
              </span>
              <button className="icon-button compact" onClick={() => void toggleQueue()} aria-label={queueStatus.paused ? '继续 AI 队列' : '暂停 AI 队列'}>
                {queueStatus.paused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </div>
            <button className="primary-button" onClick={() => setAddOpen(true)}>
              <Plus size={18} /> 添加单词
            </button>
          </div>
        </header>
        <div className="detail-scroll">
          {selected ? (
            <WordDetail
              entry={selected}
              categories={categories}
              isTrash={collectionView === 'trash'}
              onChanged={() => void load()}
              onToast={showToast}
            />
          ) : (
            <WelcomeEmpty onAdd={() => setAddOpen(true)} />
          )}
        </div>
      </section>

      {addOpen && <AddWordDialog
        onClose={() => setAddOpen(false)}
        onCreated={(result) => {
          setQuery('')
          setSelectedCategoryId(null)
          setStatusFilter('all')
          setCollectionView(result.entry.isDeleted ? 'trash' : 'active')
          setSelectedId(result.entry.id)
          setAddOpen(false)
        }}
        onToast={showToast}
      />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.kind === 'error' ? <CircleAlert size={18} /> : <Check size={18} />}{toast.message}</div>}
    </main>
  )
}

function Sidebar({
  categories,
  selectedCategoryId,
  collectionView,
  onSelectCategory,
  onShowAll,
  onShowTrash,
  onCreateCategory,
  onDeleteCategory,
  onOpenSettings
}: {
  categories: Category[]
  selectedCategoryId: string | null
  collectionView: CollectionView
  onSelectCategory: (id: string) => void
  onShowAll: () => void
  onShowTrash: () => void
  onCreateCategory: () => void
  onDeleteCategory: (category: Category) => void
  onOpenSettings: () => void
}): ReactElement {
  const total = categories.reduce((sum, category) => sum + category.wordCount, 0)
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <span className="brand-mark"><BookOpen size={21} /></span>
        <span>生词本</span>
      </div>
      <nav className="side-nav" aria-label="词库导航">
        <button className={`side-nav-item ${collectionView === 'active' && !selectedCategoryId ? 'active' : ''}`} onClick={onShowAll}>
          <span><BookOpen size={17} /> 全部单词</span><b>{total}</b>
        </button>
        <div className="sidebar-section-heading"><span>分类</span><button className="icon-button compact" onClick={onCreateCategory} aria-label="新建分类"><FolderPlus size={16} /></button></div>
        <div className="category-list">
          {categories.map((category) => (
            <div className={`category-item ${collectionView === 'active' && selectedCategoryId === category.id ? 'active' : ''}`} key={category.id}>
              <button onClick={() => onSelectCategory(category.id)}>
                <span><i style={{ background: category.color }} /><span>{category.name}</span></span><b>{category.wordCount}</b>
              </button>
              {category.id !== 'uncategorized' && <button className="category-delete" onClick={() => onDeleteCategory(category)} aria-label={`删除分类 ${category.name}`}><X size={13} /></button>}
            </div>
          ))}
        </div>
      </nav>
      <div className="sidebar-footer">
        <button className={`side-nav-item ${collectionView === 'trash' ? 'active' : ''}`} onClick={onShowTrash}><span><Trash2 size={17} /> 回收站</span></button>
        <button className="side-nav-item" onClick={onOpenSettings}><span><Settings size={17} /> 设置</span></button>
      </div>
    </aside>
  )
}

function WordRow({ entry, selected, onClick }: { entry: WordEntry; selected: boolean; onClick: () => void }): ReactElement {
  const definition = entry.senses[0]?.definitionZh || (entry.status === 'pending' ? '等待 AI 补全…' : '尚未填写释义')
  return (
    <button className={`word-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="word-row-main"><strong>{entry.word}</strong><em>{entry.ipaUk ? `/${entry.ipaUk.replace(/^\/+|\/+$/g, '')}/` : '—'}</em></span>
      <span className="word-row-definition">{definition}</span>
      <span className="word-row-footer"><StatusBadge status={entry.status} /><span className="row-category"><i style={{ background: entry.categoryColor }} />{entry.categoryName}</span></span>
    </button>
  )
}

function StatusBadge({ status }: { status: EnrichmentStatus }): ReactElement {
  return <span className={`status-badge ${statusTone[status]}`}>{status === 'processing' && <LoaderCircle size={12} className="spin" />}{statusCopy[status]}</span>
}

function WordDetail({ entry, categories, isTrash, onChanged, onToast }: { entry: WordEntry; categories: Category[]; isTrash: boolean; onChanged: () => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [draft, setDraft] = useState<WordDraft>(() => asDraft(entry))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (draft.id !== entry.id || !dirty) {
      setDraft(asDraft(entry))
      if (draft.id !== entry.id) setDirty(false)
    }
  }, [entry])

  const editDraft = (nextDraft: WordDraft): void => {
    setDraft(nextDraft)
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.api.words.save(draft)
      setDraft(asDraft(saved))
      setDirty(false)
      onToast('success', '单词已保存。')
      onChanged()
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  const retry = async (): Promise<void> => {
    await window.api.queue.retry(entry.id)
    onToast('success', '已重新加入 AI 队列。')
    onChanged()
  }

  const moveToTrash = async (): Promise<void> => {
    if (!window.confirm(`将「${entry.word}」移入回收站？`)) return
    await window.api.words.trash(entry.id)
    onToast('success', '已移入回收站。')
    onChanged()
  }

  const restore = async (): Promise<void> => {
    await window.api.words.restore(entry.id)
    onToast('success', '已恢复单词。')
    onChanged()
  }

  const acceptSuggestedCategory = async (): Promise<void> => {
    if (!entry.suggestedCategory) return
    try {
      const category = await window.api.categories.create(entry.suggestedCategory, CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length])
      const saved = await window.api.words.save({ ...draft, categoryId: category.id })
      setDraft(asDraft(saved))
      setDirty(false)
      onToast('success', `已创建并应用分类「${category.name}」。`)
      onChanged()
    } catch (error) {
      onToast('error', messageOf(error))
    }
  }

  if (isTrash) {
    return (
      <div className="empty-detail trashed-detail">
        <ArchiveRestore size={28} />
        <h2>此单词在回收站中</h2>
        <p>恢复后会回到主词库，原有释义、词根和分类都会保留。</p>
        <button className="primary-button" onClick={() => void restore()}><ArchiveRestore size={17} />恢复单词</button>
      </div>
    )
  }

  return (
    <article className="detail-card">
      <div className="detail-status-line"><StatusBadge status={entry.status} />{entry.aiReviewed && <span className="verified-note"><Check size={14} /> 已人工核对</span>}</div>
      {entry.aiError && <div className="inline-alert"><CircleAlert size={17} /><span>{entry.aiError}</span><button onClick={() => void retry()}><RefreshCw size={14} />重试</button></div>}

      <section className="form-section word-heading-section">
        <label>单词<input value={draft.word} onChange={(event) => editDraft({ ...draft, word: event.target.value })} /></label>
        <label>英式 IPA<input value={draft.ipaUk} onChange={(event) => editDraft({ ...draft, ipaUk: event.target.value })} placeholder="例如 ˈvɒkəbjəlri" /></label>
      </section>

      <section className="form-section">
        <div className="section-title"><div><p className="eyebrow">词义</p><h2>词性与中文释义</h2></div><button className="outline-button" onClick={() => editDraft({ ...draft, senses: [...draft.senses, blankSense()] })}><Plus size={15} />添加义项</button></div>
        <div className="sense-stack">
          {draft.senses.map((sense, index) => (
            <div className="sense-row" key={`${entry.id}-${index}`}>
              <input value={sense.partOfSpeech} onChange={(event) => editDraft({ ...draft, senses: replaceSense(draft.senses, index, { ...sense, partOfSpeech: event.target.value }) })} placeholder="词性，如 noun" aria-label="词性" />
              <input value={sense.definitionZh} onChange={(event) => editDraft({ ...draft, senses: replaceSense(draft.senses, index, { ...sense, definitionZh: event.target.value }) })} placeholder="中文释义" aria-label="中文释义" />
              <button className="icon-button compact" onClick={() => editDraft({ ...draft, senses: draft.senses.length > 1 ? draft.senses.filter((_, itemIndex) => itemIndex !== index) : [blankSense()] })} aria-label="删除义项"><X size={15} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="form-section classification-section">
        <div className="section-title"><div><p className="eyebrow">归类</p><h2>分类与标签</h2></div></div>
        <div className="form-grid">
          <label>主分类<select value={draft.categoryId} onChange={(event) => editDraft({ ...draft, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>标签<input value={draft.tagNames.join('，')} onChange={(event) => editDraft({ ...draft, tagNames: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="用逗号分隔" /></label>
        </div>
        {entry.suggestedCategory && <div className="suggestion"><Sparkles size={16} /><span>AI 建议新分类「{entry.suggestedCategory}」</span><button onClick={() => void acceptSuggestedCategory()}>确认创建</button></div>}
      </section>

      <section className="form-section roots-section">
        <div className="section-title"><div><p className="eyebrow">词源</p><h2>词根关联</h2></div><span className="source-label">来自本地辞典</span></div>
        {entry.rootMatches.length ? <div className="root-grid">{entry.rootMatches.map((match) => <button className="root-card" key={`${match.root}-${match.sourceAnchor}`} onClick={() => void window.api.roots.openSource(match.sourceAnchor)}><span className="root-card-top"><code>{match.root}</code><ExternalLink size={14} /></span><strong>{match.meaning}</strong>{match.formationNote && <p>{match.formationNote}</p>}<small>{match.matchedVia === 'lemma' ? '按原形匹配 · ' : ''}{match.sourceLabel}</small></button>)}</div> : <div className="root-empty"><Tag size={17} />该辞典暂未找到可核实的词根。</div>}
      </section>

      <section className="form-section review-section">
        <label className="check-field"><input type="checkbox" checked={draft.aiReviewed} onChange={(event) => editDraft({ ...draft, aiReviewed: event.target.checked })} />我已核对当前内容</label>
        <div className="detail-actions"><button className="danger-button" onClick={() => void moveToTrash()}><Trash2 size={16} />移入回收站</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? '保存中' : '保存修改'}</button></div>
      </section>
    </article>
  )
}

function AddWordDialog({ onClose, onCreated, onToast }: { onClose: () => void; onCreated: (result: WordCreateResult) => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [word, setWord] = useState('')
  const [creating, setCreating] = useState(false)
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setCreating(true)
    try {
      const result = await window.api.words.create(word)
      onToast('success', result.duplicate ? '该单词已存在，已为你打开。' : '单词已加入待 AI 处理队列。')
      onCreated(result)
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setCreating(false)
    }
  }
  return <Dialog title="添加单词" onClose={onClose}><form onSubmit={(event) => void create(event)}><p className="dialog-description">先收下单词；本地 AI 准备好后会自动补全 IPA、释义、分类建议和标签。</p><label>英文单词<input autoFocus value={word} onChange={(event) => setWord(event.target.value)} placeholder="例如 vocabulary" /></label><div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>取消</button><button className="primary-button" disabled={creating}>{creating ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}加入队列</button></div></form></Dialog>
}

function SettingsDialog({ onClose, onToast }: { onClose: () => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [rootStatus, setRootStatus] = useState<RootIndexStatus | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [nextSettings, nextOllama, nextRoot] = await Promise.all([window.api.settings.get(), window.api.ollama.check(), window.api.roots.status()])
      setSettings(nextSettings)
      setOllama(nextOllama)
      setRootStatus(nextRoot)
    } catch (error) {
      onToast('error', messageOf(error))
    }
  }

  useEffect(() => { void reload() }, [])

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await window.api.settings.save(settings)
      setSettings(saved)
      onToast('success', '设置已保存。')
      await reload()
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  const chooseDictionary = async (): Promise<void> => {
    const selected = await window.api.roots.chooseFile()
    if (selected && settings) setSettings({ ...settings, dictionaryPath: selected })
  }

  const rebuildIndex = async (): Promise<void> => {
    if (!settings) return
    try {
      await window.api.settings.save(settings)
      const nextStatus = await window.api.roots.rebuild()
      setRootStatus(nextStatus)
      onToast('success', nextStatus.message)
    } catch (error) {
      onToast('error', messageOf(error))
    }
  }

  const exportData = async (format: ExportFormat): Promise<void> => {
    try {
      const exported = await window.api.data.export(format)
      if (exported) onToast('success', `${format.toUpperCase()} 导出完成。`)
    } catch (error) {
      onToast('error', messageOf(error))
    }
  }

  return <Dialog title="设置" onClose={onClose} wide>{!settings ? <ListLoading /> : <div className="settings-stack">
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Sparkles size={18} /></span><div><h3>本地 AI</h3><p>{ollama?.message ?? '正在检查 Ollama…'}</p></div><span className={`connection-dot ${ollama?.available ? 'online' : ''}`} /></div><label>Ollama 地址<input value={settings.ollamaUrl} onChange={(event) => setSettings({ ...settings, ollamaUrl: event.target.value })} /></label><label>默认模型<select value={settings.ollamaModel} onChange={(event) => setSettings({ ...settings, ollamaModel: event.target.value })}><option value="">自动选择第一个可用模型</option>{ollama?.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><button className="outline-button" onClick={() => void reload()}><RefreshCw size={15} />重新检测</button></section>
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Database size={18} /></span><div><h3>词根辞典</h3><p>{rootStatus?.message ?? '正在读取索引状态…'}</p></div></div><label>HTML 文件<input value={settings.dictionaryPath} onChange={(event) => setSettings({ ...settings, dictionaryPath: event.target.value })} /></label><div className="setting-buttons"><button className="outline-button" onClick={() => void chooseDictionary()}>选择文件</button><button className="outline-button" onClick={() => void rebuildIndex()}><RefreshCw size={15} />重建索引{rootStatus?.ready ? ` · ${rootStatus.indexedWords} 词` : ''}</button></div></section>
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><FileDown size={18} /></span><div><h3>数据与备份</h3><p>数据库每小时检查跨日备份，保留最近 7 份。</p></div></div><div className="setting-buttons"><button className="outline-button" onClick={() => void window.api.data.openFolder()}>打开数据目录</button><button className="outline-button" onClick={() => void exportData('json')}>导出 JSON</button><button className="outline-button" onClick={() => void exportData('csv')}>导出 CSV</button><button className="outline-button" onClick={() => void exportData('sqlite')}>导出 SQLite</button></div></section>
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>关闭</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存设置</button></div>
  </div>}</Dialog>
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }): ReactElement {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>{children}</section></div>
}

function ListLoading(): ReactElement { return <div className="list-loading"><LoaderCircle size={20} className="spin" />正在读取词库…</div> }
function ListEmpty({ view, query }: { view: CollectionView; query: string }): ReactElement { return <div className="list-empty">{view === 'trash' ? <Trash2 size={24} /> : <Search size={24} />}<strong>{view === 'trash' ? '回收站是空的' : query ? '没有匹配的单词' : '还没有单词'}</strong><span>{view === 'trash' ? '被移除的单词会先保存在这里。' : query ? '换个关键词试试。' : '点击右上角“添加单词”开始建立词库。'}</span></div> }
function WelcomeEmpty({ onAdd }: { onAdd: () => void }): ReactElement { return <div className="empty-detail"><span className="empty-emblem"><BookOpen size={30} /></span><h2>从第一个单词开始</h2><p>先把不熟悉的词收进来；AI 与词根索引会在后台慢慢替你补全。</p><button className="primary-button" onClick={onAdd}><Plus size={17} />添加单词</button></div> }

function asDraft(entry: WordEntry): WordDraft { return { id: entry.id, word: entry.word, ipaUk: entry.ipaUk, senses: entry.senses.length ? entry.senses : [blankSense()], categoryId: entry.categoryId, tagNames: entry.tags.map((tag) => tag.name), aiReviewed: entry.aiReviewed } }
function replaceSense(senses: WordSense[], index: number, replacement: WordSense): WordSense[] { return senses.map((sense, itemIndex) => (itemIndex === index ? replacement : sense)) }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '发生了未知错误。' }
