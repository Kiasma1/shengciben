import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
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
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareStack,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import type {
  AppSettingsView,
  Category,
  DeepSeekStatus,
  EnrichmentStatus,
  ExportFormat,
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
type MotionState = 'open' | 'closing'
const CATEGORY_COLORS = ['#6e6e6e']

const statusCopy: Record<EnrichmentStatus, string> = {
  pending: '待 AI 处理',
  processing: 'AI 处理中',
  ready: '已完成',
  failed: '处理失败'
}

const statusTone: Record<EnrichmentStatus, string> = {
  pending: 'muted',
  processing: 'processing',
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
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [detailDirty, setDetailDirty] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [toastClosing, setToastClosing] = useState(false)
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ pending: 0, processing: 0, failed: 0, paused: false })
  const searchRef = useRef<HTMLInputElement>(null)
  const toastCloseTimerRef = useRef<number | null>(null)
  const toastUnmountTimerRef = useRef<number | null>(null)
  const debouncedQuery = useDebouncedValue(query, 180)
  const addPresence = useExitPresence(addOpen, 160)
  const categoryPresence = useExitPresence(categoryOpen, 160)
  const settingsPresence = useExitPresence(settingsOpen, 160)

  const filters = useMemo(
    () => ({
      query: debouncedQuery,
      categoryId: selectedCategoryId,
      status: statusFilter,
      sort,
      includeDeleted: collectionView === 'trash'
    }),
    [collectionView, debouncedQuery, selectedCategoryId, sort, statusFilter]
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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      if (event.key.toLocaleLowerCase('en-US') === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLocaleLowerCase('en-US') === 'n') {
        event.preventDefault()
        setAddOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const updateReflection = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      const control = event.target.closest<HTMLElement>('.primary-button, .outline-button')
      if (!control) return
      const bounds = control.getBoundingClientRect()
      control.style.setProperty('--glass-pointer-x', `${((event.clientX - bounds.left) / bounds.width) * 100}%`)
      control.style.setProperty('--glass-pointer-y', `${((event.clientY - bounds.top) / bounds.height) * 100}%`)
    }

    const resetReflection = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      const control = event.target.closest<HTMLElement>('.primary-button, .outline-button')
      if (!control || (event.relatedTarget instanceof Node && control.contains(event.relatedTarget))) return
      control.style.removeProperty('--glass-pointer-x')
      control.style.removeProperty('--glass-pointer-y')
    }

    document.addEventListener('pointermove', updateReflection)
    document.addEventListener('pointerout', resetReflection)
    return () => {
      document.removeEventListener('pointermove', updateReflection)
      document.removeEventListener('pointerout', resetReflection)
    }
  }, [])

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChanged(setMaximized)
  }, [])

  useEffect(() => {
    setDetailDirty(false)
  }, [selectedId])

  useEffect(() => () => {
    if (toastCloseTimerRef.current !== null) window.clearTimeout(toastCloseTimerRef.current)
    if (toastUnmountTimerRef.current !== null) window.clearTimeout(toastUnmountTimerRef.current)
  }, [])

  const showToast = (kind: ToastKind, message: string): void => {
    if (toastCloseTimerRef.current !== null) window.clearTimeout(toastCloseTimerRef.current)
    if (toastUnmountTimerRef.current !== null) window.clearTimeout(toastUnmountTimerRef.current)
    setToast({ kind, message })
    setToastClosing(false)
    toastCloseTimerRef.current = window.setTimeout(() => {
      setToastClosing(true)
      toastCloseTimerRef.current = null
    }, 3440)
    toastUnmountTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastUnmountTimerRef.current = null
    }, 3600)
  }

  const createCategory = async (name: string): Promise<void> => {
    try {
      const category = await window.api.categories.create(name, CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length])
      setSelectedCategoryId(category.id)
      setCollectionView('active')
      setCategoryOpen(false)
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

  const emptyTrash = async (): Promise<void> => {
    if (!window.confirm('永久删除回收站中的全部单词？释义、标签关系、词根匹配和 AI 任务也会一并删除，且无法撤销。')) return
    try {
      const deletedCount = await window.api.words.emptyTrash()
      setSelectedId(null)
      showToast('success', deletedCount ? `已永久删除 ${deletedCount} 个单词。` : '回收站已经是空的。')
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const closeWindow = (): void => {
    if (!detailDirty || window.confirm('当前单词有尚未保存的修改，仍要关闭生词本吗？')) window.api.window.close()
  }

  return (
    <div className="app-frame">
      <TitleBar
        maximized={maximized}
        onMinimize={() => window.api.window.minimize()}
        onToggleMaximize={() => window.api.window.toggleMaximize()}
        onClose={closeWindow}
      />
      <main className="app-shell">
      <a className="skip-link" href="#word-list">跳到单词列表</a>
      <a className="skip-link" href="#word-detail">跳到单词详情</a>
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
        onCreateCategory={() => setCategoryOpen(true)}
        onDeleteCategory={(category) => void removeCategory(category)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <section id="word-list" className="word-column" aria-label="单词列表" tabIndex={-1}>
        <header className="list-header">
          <div className="word-search">
            <Search size={18} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词、释义、标签或词根" aria-label="搜索单词" aria-keyshortcuts="Control+K" />
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
              <option value="ready">已完成</option>
              <option value="failed">处理失败</option>
            </select>
            <button className="text-button" onClick={() => setSort((value) => (value === 'recent' ? 'alphabetical' : 'recent'))} aria-label={`当前按${sort === 'recent' ? '最近更新' : '字母顺序'}排列，点击切换`}>
              {sort === 'recent' ? '最近更新' : 'A–Z'}
            </button>
          </div>
        </header>

        <div className="list-summary">
          <span>{collectionView === 'trash' ? '回收站' : selectedCategoryId ? '已筛选' : '全部单词'}</span>
          <span>{entries.length} 个条目</span>
        </div>

        <div className="word-list" aria-busy={isLoading}>
          {isLoading ? <ListLoading /> : entries.length ? entries.map((entry) => <WordRow key={entry.id} entry={entry} selected={entry.id === selected?.id} onClick={() => setSelectedId(entry.id)} />) : <ListEmpty view={collectionView} query={query} />}
        </div>
      </section>

      <section id="word-detail" className="detail-column" aria-label="单词详情" tabIndex={-1}>
        <header className="detail-header">
          <div>
            <p className="eyebrow">{collectionView === 'trash' ? '回收站' : '个人词库'}</p>
            <h1 lang={selected ? 'en' : undefined}>{selected ? selected.word : collectionView === 'trash' ? '已删除的单词' : '生词本'}</h1>
          </div>
          <div className="header-actions">
            {collectionView === 'trash' ? (
              <button className="primary-button empty-trash-button" disabled={isLoading || (!query.trim() && statusFilter === 'all' && entries.length === 0)} onClick={() => void emptyTrash()} aria-label="永久删除回收站中的全部单词">
                <Trash2 size={17} /> 清空回收站
              </button>
            ) : (
              <>
                <div className={`queue-control ${queueStatus.paused ? 'paused' : ''}`} role="status" aria-live="polite">
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
                <button className="primary-button" onClick={() => setAddOpen(true)} aria-keyshortcuts="Control+N">
                  <Plus size={18} /> 添加单词
                </button>
              </>
            )}
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
              onDirtyChange={setDetailDirty}
            />
          ) : collectionView === 'trash' ? (
            <TrashEmpty />
          ) : (
            <WelcomeEmpty onAdd={() => setAddOpen(true)} />
          )}
        </div>
      </section>

      {addPresence.rendered && <AddWordDialog
        motionState={addPresence.state}
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
      {categoryPresence.rendered && <CategoryDialog
        motionState={categoryPresence.state}
        color={CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]}
        onClose={() => setCategoryOpen(false)}
        onCreate={createCategory}
      />}
      {settingsPresence.rendered && <SettingsDialog motionState={settingsPresence.state} onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      {toast && <div className={`toast ${toast.kind}`} data-state={toastClosing ? 'closing' : 'open'} role="status" aria-live="polite">{toast.kind === 'error' ? <CircleAlert size={18} /> : <Check size={18} />}{toast.message}</div>}
      </main>
    </div>
  )
}

function TitleBar({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose
}: {
  maximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}): ReactElement {
  return (
    <header className="titlebar" onDoubleClick={(event) => {
      if (!(event.target as HTMLElement).closest('button')) onToggleMaximize()
    }}>
      <div className="titlebar-brand"><span className="titlebar-mark"><BookOpen size={15} /></span><span>生词本</span></div>
      <div className="titlebar-spacer" />
      <div className="window-controls">
        <button onClick={onMinimize} aria-label="最小化"><Minus size={16} /></button>
        <button onClick={onToggleMaximize} aria-label={maximized ? '还原窗口' : '最大化窗口'}>{maximized ? <SquareStack size={14} /> : <Maximize2 size={14} />}</button>
        <button className="window-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
      </div>
    </header>
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
      <nav className="side-nav" aria-label="词库导航">
        <button className={`side-nav-item ${collectionView === 'active' && !selectedCategoryId ? 'active' : ''}`} onClick={onShowAll} aria-current={collectionView === 'active' && !selectedCategoryId ? 'page' : undefined}>
          <span><BookOpen size={17} /> 全部单词</span><b>{total}</b>
        </button>
        <div className="sidebar-section-heading"><span>分类</span><button className="icon-button compact" onClick={onCreateCategory} aria-label="新建分类"><FolderPlus size={16} /></button></div>
        <div className="category-list">
          {categories.map((category) => (
            <div className={`category-item ${collectionView === 'active' && selectedCategoryId === category.id ? 'active' : ''}`} key={category.id}>
              <button onClick={() => onSelectCategory(category.id)} aria-current={collectionView === 'active' && selectedCategoryId === category.id ? 'page' : undefined}>
                <span><i style={{ background: category.color }} /><span>{category.name}</span></span><b>{category.wordCount}</b>
              </button>
              {category.id !== 'uncategorized' && <button className="category-delete" onClick={() => onDeleteCategory(category)} aria-label={`删除分类 ${category.name}`}><X size={13} /></button>}
            </div>
          ))}
        </div>
      </nav>
      <div className="sidebar-footer">
        <button className={`side-nav-item ${collectionView === 'trash' ? 'active' : ''}`} onClick={onShowTrash} aria-current={collectionView === 'trash' ? 'page' : undefined}><span><Trash2 size={17} /> 回收站</span></button>
        <button className="side-nav-item" onClick={onOpenSettings}><span><Settings size={17} /> 设置</span></button>
      </div>
    </aside>
  )
}

function WordRow({ entry, selected, onClick }: { entry: WordEntry; selected: boolean; onClick: () => void }): ReactElement {
  const definition = entry.senses[0]?.definitionZh || (entry.status === 'pending' ? '等待 AI 补全…' : '尚未填写释义')
  return (
    <button className={`word-row ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span className="word-row-main"><strong lang="en" title={entry.word}>{entry.word}</strong><em lang="en">{entry.ipaUk ? `/${entry.ipaUk.replace(/^\/+|\/+$/g, '')}/` : '—'}</em></span>
      <span className="word-row-definition" title={definition}>{definition}</span>
      <span className="word-row-footer"><StatusBadge status={entry.status} /><span className="row-category"><i style={{ background: entry.categoryColor }} />{entry.categoryName}</span></span>
    </button>
  )
}

function StatusBadge({ status }: { status: EnrichmentStatus }): ReactElement {
  return <span className={`status-badge ${statusTone[status]}`}>{status === 'processing' && <LoaderCircle size={12} className="spin" />}{statusCopy[status]}</span>
}

function WordDetail({ entry, categories, isTrash, onChanged, onToast, onDirtyChange }: { entry: WordEntry; categories: Category[]; isTrash: boolean; onChanged: () => void; onToast: (kind: 'success' | 'error', message: string) => void; onDirtyChange: (dirty: boolean) => void }): ReactElement {
  const [draft, setDraft] = useState<WordDraft>(() => asDraft(entry))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

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
      <div className="detail-status-line"><StatusBadge status={entry.status} /></div>
      {entry.aiError && <div className="inline-alert"><CircleAlert size={17} /><span>{entry.aiError}</span><button onClick={() => void retry()}><RefreshCw size={14} />重试</button></div>}

      <section className="form-section word-heading-section">
        <label>单词<input className="latin-field" lang="en" value={draft.word} onChange={(event) => editDraft({ ...draft, word: event.target.value })} /></label>
        <label>英式 IPA<input className="latin-field" lang="en" value={draft.ipaUk} onChange={(event) => editDraft({ ...draft, ipaUk: event.target.value })} placeholder="例如 ˈvɒkəbjəlri" /></label>
      </section>

      <section className="form-section">
        <div className="section-title"><div><p className="eyebrow">词义</p><h2>词性与中文释义</h2></div><button className="outline-button" onClick={() => editDraft({ ...draft, senses: [...draft.senses, blankSense()] })}><Plus size={15} />添加义项</button></div>
        <div className="sense-stack">
          {draft.senses.map((sense, index) => (
            <div className="sense-row" key={`${entry.id}-${index}`}>
              <input className="latin-field" value={sense.partOfSpeech} onChange={(event) => editDraft({ ...draft, senses: replaceSense(draft.senses, index, { ...sense, partOfSpeech: event.target.value }) })} placeholder="词性，如 noun" aria-label="词性" />
              <input className="reading-field" value={sense.definitionZh} onChange={(event) => editDraft({ ...draft, senses: replaceSense(draft.senses, index, { ...sense, definitionZh: event.target.value }) })} placeholder="中文释义" aria-label="中文释义" />
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
      </section>

      <section className="form-section roots-section">
        <div className="section-title"><div><p className="eyebrow">词源</p><h2>词根关联</h2></div><span className="source-label">来自本地辞典</span></div>
        {entry.rootMatches.length ? <div className="root-grid">{entry.rootMatches.map((match) => <button className="root-card" key={`${match.root}-${match.sourceAnchor}`} onClick={() => void window.api.roots.openSource(match.sourceAnchor)} aria-label={`在本地辞典中查看词根 ${match.root}`}><span className="root-card-top"><code lang="en">{match.root}</code><ExternalLink size={14} /></span><strong>{match.meaning}</strong>{match.formationNote && <p>{match.formationNote}</p>}<small>{match.matchedVia === 'lemma' ? '按原形匹配 · ' : ''}{match.sourceLabel}</small></button>)}</div> : <div className="root-empty"><Tag size={17} />该辞典暂未找到可核实的词根。</div>}
      </section>

      <section className="form-section actions-section">
        <div className="detail-actions"><button className="danger-button" onClick={() => void moveToTrash()}><Trash2 size={16} />移入回收站</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{saving ? '保存中' : '保存修改'}</button></div>
      </section>
    </article>
  )
}

function AddWordDialog({ motionState, onClose, onCreated, onToast }: { motionState: MotionState; onClose: () => void; onCreated: (result: WordCreateResult) => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [word, setWord] = useState('')
  const [creating, setCreating] = useState(false)
  const requestClose = (): void => {
    if (!word.trim() || window.confirm('放弃尚未加入词库的单词？')) onClose()
  }
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
  return <Dialog title="添加单词" motionState={motionState} onClose={requestClose}><form onSubmit={(event) => void create(event)}><p className="dialog-description">先收下单词；DeepSeek 配置好后会自动补全 IPA、释义、分类和标签。</p><label>英文单词<input className="latin-field" lang="en" autoFocus data-initial-focus value={word} onChange={(event) => setWord(event.target.value)} placeholder="例如 vocabulary" /></label><div className="dialog-actions"><button type="button" className="text-button" onClick={requestClose}>取消</button><button className="primary-button" disabled={creating || !word.trim()}>{creating ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}加入队列</button></div></form></Dialog>
}

function CategoryDialog({ motionState, color, onClose, onCreate }: { motionState: MotionState; color: string; onClose: () => void; onCreate: (name: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const requestClose = (): void => {
    if (!name.trim() || window.confirm('放弃尚未创建的分类？')) onClose()
  }
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      await onCreate(name.trim())
    } finally {
      setCreating(false)
    }
  }
  return <Dialog title="新建分类" motionState={motionState} onClose={requestClose}><form onSubmit={(event) => void create(event)}><p className="dialog-description">分类负责整理主线主题；更细的交叉关系可以继续使用标签。</p><label>分类名称<input autoFocus data-initial-focus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 学术写作" /></label><div className="category-preview"><span className="category-preview-dot" style={{ background: color }} /><span>{name.trim() || '新分类'}</span></div><div className="dialog-actions"><button type="button" className="text-button" onClick={requestClose}>取消</button><button className="primary-button" disabled={creating || !name.trim()}>{creating ? <LoaderCircle size={17} className="spin" /> : <FolderPlus size={17} />}创建分类</button></div></form></Dialog>
}

function SettingsDialog({ motionState, onClose, onToast }: { motionState: MotionState; onClose: () => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [settings, setSettings] = useState<AppSettingsView | null>(null)
  const [initialSettings, setInitialSettings] = useState<AppSettingsView | null>(null)
  const [deepseek, setDeepseek] = useState<DeepSeekStatus | null>(null)
  const [rootStatus, setRootStatus] = useState<RootIndexStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const [nextSettings, nextRoot] = await Promise.all([window.api.settings.get(), window.api.roots.status()])
      setSettings(nextSettings)
      setInitialSettings(nextSettings)
      setRootStatus(nextRoot)
      setChecking(true)
      setDeepseek(await window.api.deepseek.check(nextSettings))
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { void load() }, [])

  const checkConnection = async (): Promise<void> => {
    if (!settings) return
    setChecking(true)
    try {
      setDeepseek(await window.api.deepseek.check(settings))
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setChecking(false)
    }
  }

  const requestClose = (): void => {
    const dirty = settings && initialSettings && JSON.stringify(settings) !== JSON.stringify(initialSettings)
    if (!dirty || window.confirm('放弃尚未保存的设置？')) onClose()
  }

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await window.api.settings.save(settings)
      setSettings(saved)
      setInitialSettings(saved)
      onToast('success', '设置已保存。')
      setChecking(true)
      setDeepseek(await window.api.deepseek.check(saved))
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setSaving(false)
      setChecking(false)
    }
  }

  const chooseDictionary = async (): Promise<void> => {
    const selected = await window.api.roots.chooseFile()
    if (selected && settings) setSettings({ ...settings, dictionaryPath: selected })
  }

  const rebuildIndex = async (): Promise<void> => {
    if (!settings) return
    try {
      const saved = await window.api.settings.save(settings)
      setSettings(saved)
      setInitialSettings(saved)
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

  const modelOptions = settings ? [...new Set([settings.deepseekModel, ...(deepseek?.models ?? [])].filter(Boolean))] : []

  return <Dialog title="设置" motionState={motionState} onClose={requestClose} wide>{!settings ? <ListLoading /> : <div className="settings-stack">
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Sparkles size={18} /></span><div><h3>DeepSeek AI</h3><p>{checking ? '正在检查 DeepSeek…' : deepseek?.message ?? '尚未检测 DeepSeek。'}</p></div><span className={`connection-dot ${deepseek?.available ? 'online' : ''}`} /></div><label>API Key<input className="latin-field" type="password" autoComplete="new-password" value={settings.deepseekApiKey} placeholder={settings.hasDeepseekApiKey ? '已安全保存；留空则不修改' : 'sk-…'} onChange={(event) => setSettings({ ...settings, deepseekApiKey: event.target.value, clearDeepseekApiKey: false })} /></label><label>API 地址<input className="latin-field" value={settings.deepseekApiUrl} onChange={(event) => setSettings({ ...settings, deepseekApiUrl: event.target.value })} /></label><label>默认模型<select value={settings.deepseekModel} onChange={(event) => setSettings({ ...settings, deepseekModel: event.target.value })}>{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><div className="setting-buttons"><button className="outline-button" disabled={checking} onClick={() => void checkConnection()}>{checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}检测 DeepSeek</button><button className="text-button" disabled={!settings.hasDeepseekApiKey && !settings.deepseekApiKey} onClick={() => setSettings({ ...settings, deepseekApiKey: '', hasDeepseekApiKey: false, clearDeepseekApiKey: true })}>清除 API Key</button></div></section>
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Database size={18} /></span><div><h3>词根辞典</h3><p>{rootStatus?.message ?? '正在读取索引状态…'}</p></div></div><label>HTML 文件<input value={settings.dictionaryPath} onChange={(event) => setSettings({ ...settings, dictionaryPath: event.target.value })} /></label><div className="setting-buttons"><button className="outline-button" onClick={() => void chooseDictionary()}>选择文件</button><button className="outline-button" onClick={() => void rebuildIndex()}><RefreshCw size={15} />重建索引{rootStatus?.ready ? ` · ${rootStatus.indexedWords} 词` : ''}</button></div></section>
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><FileDown size={18} /></span><div><h3>数据与备份</h3><p>数据库每小时检查跨日备份，保留最近 7 份。</p></div></div><div className="setting-buttons"><button className="outline-button" onClick={() => void window.api.data.openFolder()}>打开数据目录</button><button className="outline-button" onClick={() => void exportData('json')}>导出 JSON</button><button className="outline-button" onClick={() => void exportData('csv')}>导出 CSV</button><button className="outline-button" onClick={() => void exportData('sqlite')}>导出 SQLite</button></div></section>
    <div className="dialog-actions"><button className="text-button" onClick={requestClose}>关闭</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存设置</button></div>
  </div>}</Dialog>
}

function Dialog({ title, motionState, onClose, children, wide = false }: { title: string; motionState: MotionState; onClose: () => void; children: ReactNode; wide?: boolean }): ReactElement {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    const focusFirst = (): void => {
      const preferred = dialog?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialog?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)') ?? dialog?.querySelector<HTMLElement>(focusableSelector)
      ;(preferred ?? dialog)?.focus({ preventScroll: true })
    }
    focusFirst()
    const focusFrame = window.requestAnimationFrame(focusFirst)
    const focusTimer = window.setTimeout(focusFirst, 50)
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [])
  return <div className="dialog-backdrop" data-state={motionState} role="presentation"><section ref={dialogRef} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>{children}</section></div>
}

function ListLoading(): ReactElement { return <div className="list-loading"><LoaderCircle size={20} className="spin" />正在读取词库…</div> }
function ListEmpty({ view, query }: { view: CollectionView; query: string }): ReactElement { return <div className="list-empty">{view === 'trash' ? <Trash2 size={24} /> : <Search size={24} />}<strong>{view === 'trash' ? '回收站是空的' : query ? '没有匹配的单词' : '还没有单词'}</strong><span>{view === 'trash' ? '被移除的单词会先保存在这里。' : query ? '换个关键词试试。' : '点击右上角“添加单词”开始建立词库。'}</span></div> }
function WelcomeEmpty({ onAdd }: { onAdd: () => void }): ReactElement { return <div className="empty-detail"><span className="empty-emblem"><BookOpen size={30} /></span><h2>从第一个单词开始</h2><p>先把不熟悉的词收进来；AI 与词根索引会在后台慢慢替你补全。</p><button className="primary-button" onClick={onAdd}><Plus size={17} />添加单词</button></div> }

function TrashEmpty(): ReactElement { return <div className="empty-detail"><span className="empty-emblem"><Trash2 size={28} /></span><h2>回收站是空的</h2><p>移入回收站的单词会暂存在这里，你可以逐个恢复或一次清空。</p></div> }

function asDraft(entry: WordEntry): WordDraft { return { id: entry.id, word: entry.word, ipaUk: entry.ipaUk, senses: entry.senses.length ? entry.senses : [blankSense()], categoryId: entry.categoryId, tagNames: entry.tags.map((tag) => tag.name) } }
function replaceSense(senses: WordSense[], index: number, replacement: WordSense): WordSense[] { return senses.map((sense, itemIndex) => (itemIndex === index ? replacement : sense)) }
function useExitPresence(present: boolean, exitDuration: number): { rendered: boolean; state: MotionState } {
  const [rendered, setRendered] = useState(present)
  const [state, setState] = useState<MotionState>('open')

  useEffect(() => {
    if (present) {
      setRendered(true)
      setState('open')
      return
    }
    if (!rendered) return

    setState('closing')
    const timer = window.setTimeout(() => setRendered(false), exitDuration)
    return () => window.clearTimeout(timer)
  }, [exitDuration, present, rendered])

  return { rendered, state }
}
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debounced
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '发生了未知错误。' }
