import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  FileDown,
  FolderPlus,
  GraduationCap,
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
  MorphemeKind,
  QueueStatus,
  ReviewOverview,
  ReviewQueueResult,
  ReviewRating,
  RootMatch,
  RootIndexStatus,
  WordCreateResult,
  WordDraft,
  WordEntry,
  WordSense
} from '../../shared/types'
import { COMMON_FUNCTION_WORDS, entryInputError, isValidEntryInput } from '../../shared/entry.ts'

type CollectionView = 'active' | 'trash'
type Toast = { kind: 'success' | 'error'; message: string; action?: { label: string; onClick: () => void } } | null
type ToastKind = 'success' | 'error'
type MotionState = 'open' | 'closing'
type ReviewCounts = Record<ReviewRating, number>
const EMPTY_REVIEW_OVERVIEW: ReviewOverview = { dueCount: 0, newCount: 0, todayReviewed: 0, todayNewReviewed: 0, dailyNewLimit: 20 }
const EMPTY_REVIEW_COUNTS: ReviewCounts = { again: 0, hard: 0, good: 0, easy: 0 }
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

const morphemeKindCopy: Record<MorphemeKind, string> = {
  prefix: '前缀',
  root: '词根',
  suffix: '后缀'
}

const blankSense = (): WordSense => ({ partOfSpeech: '', definitionZh: '' })

const canAutosaveDraft = (draft: WordDraft): boolean => {
  if (!isValidEntryInput(draft.word) || !draft.categoryId) return false
  return draft.senses.every((sense) => {
    const hasPartOfSpeech = Boolean(sense.partOfSpeech.trim())
    const hasDefinition = Boolean(sense.definitionZh.trim())
    return hasPartOfSpeech === hasDefinition
  })
}

export default function App(): ReactElement {
  const [entries, setEntries] = useState<WordEntry[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<EnrichmentStatus | 'all'>('all')
  const [sort, setSort] = useState<'recent' | 'alphabetical' | 'due'>('due')
  const [collectionView, setCollectionView] = useState<CollectionView>('active')
  const [isLoading, setIsLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [detailDirty, setDetailDirty] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [toastClosing, setToastClosing] = useState(false)
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ pending: 0, processing: 0, failed: 0, paused: false })
  const [reviewOverview, setReviewOverview] = useState<ReviewOverview>(EMPTY_REVIEW_OVERVIEW)
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueResult | null>(null)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewRevealed, setReviewRevealed] = useState(false)
  const [reviewGrading, setReviewGrading] = useState(false)
  const reviewGradingRef = useRef(false)
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>(EMPTY_REVIEW_COUNTS)
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
      const [nextEntries, nextCategories, nextQueueStatus, nextReviewOverview] = await Promise.all([
        window.api.words.list(filters),
        window.api.categories.list(),
        window.api.queue.status(),
        window.api.reviews.overview()
      ])
      setEntries(nextEntries)
      setCategories(nextCategories)
      setQueueStatus(nextQueueStatus)
      setReviewOverview(nextReviewOverview)
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
      if (reviewQueue || !(event.ctrlKey || event.metaKey) || event.altKey) return
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
  }, [reviewQueue])

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
    void window.api.app.version().then(setAppVersion)
  }, [])

  useEffect(() => window.api.updates.onAvailable((version) => {
    showToast('success', `新版本 v${version} 已就绪，重启即可完成更新。`, {
      label: '重启更新',
      onClick: () => window.api.updates.install()
    })
  }), [])

  useEffect(() => {
    setDetailDirty(false)
  }, [selectedId])

  const selectWord = (id: string): void => {
    setSelectedId(id)
  }

  const openEntryByNormalized = async (word: string): Promise<void> => {
    try {
      const target = await window.api.words.getByNormalized(word)
      if (!target) throw new Error(`词库中还没有「${word}」。`)
      setQuery('')
      setSelectedCategoryId(null)
      setStatusFilter('all')
      setCollectionView('active')
      setSelectedId(target.id)
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const collectPhraseComponent = async (word: string): Promise<void> => {
    try {
      const result = await window.api.words.create(word)
      showToast('success', result.duplicate ? `「${result.entry.word}」已在词库中。` : `已添加「${result.entry.word}」，并加入 AI 队列。`)
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  useEffect(() => () => {
    if (toastCloseTimerRef.current !== null) window.clearTimeout(toastCloseTimerRef.current)
    if (toastUnmountTimerRef.current !== null) window.clearTimeout(toastUnmountTimerRef.current)
  }, [])

  const showToast = (kind: ToastKind, message: string, action?: { label: string; onClick: () => void }): void => {
    if (toastCloseTimerRef.current !== null) window.clearTimeout(toastCloseTimerRef.current)
    if (toastUnmountTimerRef.current !== null) window.clearTimeout(toastUnmountTimerRef.current)
    setToast({ kind, message, action })
    setToastClosing(false)
    if (action) return // 带操作按钮的提示常驻，等待用户操作
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
    if (!window.confirm(`删除分类「${category.name}」？其中的词条将移到“未分类”。`)) return
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

  const startReview = async (): Promise<void> => {
    try {
      const queue = await window.api.reviews.queue()
      if (!queue.items.length) {
        showToast('success', '今日已完成，没有可复习的词条。')
        return
      }
      setReviewQueue(queue)
      setReviewIndex(0)
      setReviewRevealed(false)
      setReviewGrading(false)
      setReviewCounts({ ...EMPTY_REVIEW_COUNTS })
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const finishReview = (): void => {
    setReviewQueue(null)
    setReviewIndex(0)
    setReviewRevealed(false)
    setReviewGrading(false)
    reviewGradingRef.current = false
    setReviewCounts({ ...EMPTY_REVIEW_COUNTS })
    void load()
  }

  const exitReview = (): void => {
    if (reviewQueue && reviewIndex > 0 && !window.confirm(`退出本次复习？\n\n已经完成的 ${reviewIndex} 个词条会保留记录，剩余词条可以稍后继续复习。`)) return
    finishReview()
  }

  const gradeReview = async (rating: ReviewRating): Promise<void> => {
    const item = reviewQueue?.items[reviewIndex]
    if (!item || !reviewRevealed || reviewGrading || reviewGradingRef.current) return
    reviewGradingRef.current = true
    setReviewGrading(true)
    try {
      await window.api.reviews.grade(item.entry.id, rating)
      setReviewCounts((current) => ({ ...current, [rating]: current[rating] + 1 }))
      setReviewIndex((current) => current + 1)
      setReviewRevealed(false)
      await load()
    } catch (error) {
      showToast('error', messageOf(error))
    } finally {
      reviewGradingRef.current = false
      setReviewGrading(false)
    }
  }

  const emptyTrash = async (): Promise<void> => {
    if (!window.confirm('永久删除回收站中的全部词条？释义、标签关系、词根匹配和 AI 任务也会一并删除，且无法撤销。')) return
    try {
      const deletedCount = await window.api.words.emptyTrash()
      setSelectedId(null)
      showToast('success', deletedCount ? `已永久删除 ${deletedCount} 个词条。` : '回收站已经是空的。')
    } catch (error) {
      showToast('error', messageOf(error))
    }
  }

  const closeWindow = (): void => {
    if (!detailDirty || window.confirm('当前词条有尚未保存的修改，仍要关闭生词本吗？')) window.api.window.close()
  }

  return (
    <div className="app-frame">
      <TitleBar
        maximized={maximized}
        version={appVersion}
        onMinimize={() => window.api.window.minimize()}
        onToggleMaximize={() => window.api.window.toggleMaximize()}
        onClose={closeWindow}
      />
      <main className={`app-shell ${reviewQueue ? 'reviewing' : ''}`}>
      {reviewQueue ? (
        <ReviewMode
          queue={reviewQueue}
          index={reviewIndex}
          revealed={reviewRevealed}
          grading={reviewGrading}
          counts={reviewCounts}
          onExit={exitReview}
          onReveal={() => setReviewRevealed(true)}
          onGrade={(rating) => void gradeReview(rating)}
          onDone={finishReview}
        />
      ) : <>
      <a className="skip-link" href="#word-list">跳到词汇列表</a>
      <a className="skip-link" href="#word-detail">跳到词条详情</a>
      <Sidebar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        collectionView={collectionView}
        reviewOverview={reviewOverview}
        onStartReview={() => void startReview()}
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

      <section id="word-list" className="word-column" aria-label="词汇列表" tabIndex={-1}>
        <header className="list-header">
          <div className="word-search">
            <Search size={18} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词汇、释义、标签或分析" aria-label="搜索词汇" aria-keyshortcuts="Control+K" />
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
            <button className="text-button" onClick={() => setSort((value) => (value === 'recent' ? 'alphabetical' : value === 'alphabetical' ? 'due' : 'recent'))} aria-label={`当前按${sort === 'recent' ? '最近更新' : sort === 'alphabetical' ? '字母顺序' : '记忆曲线'}排列，点击切换`}>
              {sort === 'recent' ? '最近更新' : sort === 'alphabetical' ? 'A–Z' : '记忆曲线'}
            </button>
          </div>
        </header>

        <div className="list-summary">
          <span>{collectionView === 'trash' ? '回收站' : selectedCategoryId ? '已筛选' : '全部词汇'}</span>
          <span>{entries.length} 个条目</span>
        </div>

        <div className="word-list" aria-busy={isLoading}>
          {isLoading ? <ListLoading /> : entries.length ? entries.map((entry) => <WordRow key={entry.id} entry={entry} selected={entry.id === selected?.id} onClick={() => selectWord(entry.id)} />) : <ListEmpty view={collectionView} query={query} />}
        </div>
      </section>

      <section id="word-detail" className="detail-column" aria-label="词条详情" tabIndex={-1}>
        <header className="detail-header">
          <div>
            <p className="eyebrow">{collectionView === 'trash' ? '回收站' : '个人词库'}</p>
            <h1 lang={selected ? 'en' : undefined}>{selected ? selected.word : collectionView === 'trash' ? '已删除的单词' : '生词本'}</h1>
          </div>
          <div className="header-actions">
            {collectionView === 'trash' ? (
              <button className="primary-button empty-trash-button" disabled={isLoading || (!query.trim() && statusFilter === 'all' && entries.length === 0)} onClick={() => void emptyTrash()} aria-label="永久删除回收站中的全部词条">
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
                  <Plus size={18} /> 添加词汇
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
              onOpenEntry={(word) => void openEntryByNormalized(word)}
              onCollectEntry={(word) => void collectPhraseComponent(word)}
            />
          ) : collectionView === 'trash' ? (
            <TrashEmpty />
          ) : (
            <WelcomeEmpty onAdd={() => setAddOpen(true)} />
          )}
        </div>
      </section>
      </>}

      {!reviewQueue && <>
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
      </>}
      {toast && <div className={`toast ${toast.kind}`} data-state={toastClosing ? 'closing' : 'open'} role="status" aria-live="polite">{toast.kind === 'error' ? <CircleAlert size={18} /> : <Check size={18} />}{toast.message}{toast.action && <button className="toast-action" onClick={toast.action.onClick}>{toast.action.label}</button>}</div>}
      </main>
    </div>
  )
}

function ReviewMode({ queue, index, revealed, grading, counts, onExit, onReveal, onGrade, onDone }: {
  queue: ReviewQueueResult
  index: number
  revealed: boolean
  grading: boolean
  counts: ReviewCounts
  onExit: () => void
  onReveal: () => void
  onGrade: (rating: ReviewRating) => void
  onDone: () => void
}): ReactElement {
  const reviewRef = useRef<HTMLElement>(null)
  const item = queue.items[index]
  const complete = !item

  useEffect(() => {
    reviewRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' && !revealed) {
        event.preventDefault()
        onReveal()
        return
      }
      if (!revealed || grading) return
      const rating = ({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' } as Record<string, ReviewRating | undefined>)[event.key]
      if (!rating) return
      event.preventDefault()
      onGrade(rating)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [grading, onExit, onGrade, onReveal, revealed])

  const total = queue.items.length
  const progress = complete ? 100 : (index / total) * 100
  return (
    <section ref={reviewRef} className="review-mode" aria-label="复习模式" tabIndex={-1}>
      <header className="review-header">
        <button className="review-exit" onClick={onExit}><ArrowLeft size={17} />退出复习</button>
        <div className="review-progress-copy"><strong>{complete ? total : index + 1} / {total}</strong><span>{queue.dueCount} 到期 · {queue.newCount} 新词</span></div>
      </header>
      <div className="review-progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      {complete ? (
        <ReviewComplete counts={counts} total={total} onDone={onDone} />
      ) : (
        <div className="review-card">
          <p className="eyebrow">英文词汇</p>
          <h1 lang="en">{item.entry.word}</h1>
          {!revealed ? (
            <button className="primary-button review-reveal" onClick={onReveal}>显示答案 <span>Space</span></button>
          ) : (
            <>
              <ReviewAnswer entry={item.entry} />
              <div className="review-rating-section">
                <p className="eyebrow">评分并安排下次复习</p>
                <div className="review-rating-grid">
                  {(['again', 'hard', 'good', 'easy'] as ReviewRating[]).map((rating, ratingIndex) => (
                    <button key={rating} className="review-rating-button" disabled={grading} onClick={() => onGrade(rating)}>
                      <span><b>{ratingIndex + 1}</b>{reviewRatingCopy[rating]}</span>
                      <small>{formatReviewInterval(item.intervals[rating])}</small>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

const reviewRatingCopy: Record<ReviewRating, string> = { again: '忘记', hard: '困难', good: '记得', easy: '简单' }

function formatReviewInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

function ReviewAnswer({ entry }: { entry: WordEntry }): ReactElement {
  return <div className="review-answer">
    {entry.ipaUk && <p className="review-ipa" lang="en">/{entry.ipaUk.replace(/^\/+|\/+$/g, '')}/</p>}
    <div className="review-senses">{entry.senses.filter((sense) => sense.partOfSpeech.trim() && sense.definitionZh.trim()).map((sense, index) => <p key={`${sense.partOfSpeech}-${index}`}><strong lang="en">{sense.partOfSpeech}</strong><span>{sense.definitionZh}</span></p>)}</div>
    {entry.entryType === 'phrase' ? <>
      {entry.phraseExplanation && <section className="review-formation"><p className="eyebrow">使用说明</p><p className="review-phrase-explanation">{entry.phraseExplanation}</p></section>}
      {entry.phraseComponents.length > 0 && <section className="review-roots"><p className="eyebrow">短语组成</p><div className="review-phrase-components">{entry.phraseComponents.slice(0, 4).map((component) => <p key={component.text}><strong lang="en">{component.text}</strong><span>{component.meaningZh}</span></p>)}</div></section>}
    </> : <>
      {entry.formationSummary && <section className="review-formation"><p className="eyebrow">构词</p><p>{entry.formationSummary}</p></section>}
      {entry.rootMatches.length > 0 && <section className="review-roots"><p className="eyebrow">词素</p><div className="root-grid">{entry.rootMatches.map((match) => <MorphemeCard key={`${match.root}-${match.sourceAnchor}-${match.sortOrder}`} match={match} />)}</div></section>}
    </>}
  </div>
}

function ReviewComplete({ counts, total, onDone }: { counts: ReviewCounts; total: number; onDone: () => void }): ReactElement {
  return <div className="review-complete">
    <span className="empty-emblem"><GraduationCap size={30} /></span>
    <p className="eyebrow">今日复习完成</p>
    <h1>{total} 个词条</h1>
    <div className="review-summary"><span>忘记 <b>{counts.again}</b></span><span>困难 <b>{counts.hard}</b></span><span>记得 <b>{counts.good}</b></span><span>简单 <b>{counts.easy}</b></span></div>
    <button className="primary-button" onClick={onDone}>完成</button>
  </div>
}

function TitleBar({
  maximized,
  version,
  onMinimize,
  onToggleMaximize,
  onClose
}: {
  maximized: boolean
  version: string
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}): ReactElement {
  return (
    <header className="titlebar" onDoubleClick={(event) => {
      if (!(event.target as HTMLElement).closest('button')) onToggleMaximize()
    }}>
      <div className="titlebar-brand"><span className="titlebar-mark"><BookOpen size={15} /></span><span>生词本</span>{version && <span className="titlebar-version">v{version}</span>}</div>
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
  reviewOverview,
  onStartReview,
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
  reviewOverview: ReviewOverview
  onStartReview: () => void
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
        <button className="side-nav-item" onClick={onStartReview} aria-label={reviewOverview.dueCount + reviewOverview.newCount ? `开始复习 ${reviewOverview.dueCount + reviewOverview.newCount} 个词条` : '今日复习完成'}>
          <span><GraduationCap size={17} /> {reviewOverview.dueCount + reviewOverview.newCount ? '开始复习' : '今日完成'}</span><b>{reviewOverview.dueCount + reviewOverview.newCount || ''}</b>
        </button>
        <button className={`side-nav-item ${collectionView === 'active' && !selectedCategoryId ? 'active' : ''}`} onClick={onShowAll} aria-current={collectionView === 'active' && !selectedCategoryId ? 'page' : undefined}>
          <span><BookOpen size={17} /> 全部词汇</span><b>{total}</b>
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
  const reviewTone = ((): string => {
    if (!entry.nextReviewAt) return 'due' // 从未复习：最紧迫
    const nowMs = Date.now()
    const nextMs = Date.parse(entry.nextReviewAt)
    if (nowMs >= nextMs) return 'due' // 已到期
    const soonWindow = Math.max(86400000, (nextMs - Date.parse(entry.lastReviewedAt ?? entry.createdAt)) * 0.5) // 宽限期一半内即将到期
    return nowMs >= nextMs - soonWindow ? 'soon' : 'fresh'
  })()
  return (
    <button className={`word-row ${reviewTone} ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span className="word-row-main"><span className="word-row-title"><strong lang="en" title={entry.word}>{entry.word}</strong>{entry.entryType === 'phrase' && <span className="entry-type-badge">短语</span>}</span><em lang="en">{entry.ipaUk ? `/${entry.ipaUk.replace(/^\/+|\/+$/g, '')}/` : '—'}</em></span>
      <span className="word-row-definition" title={definition}>{definition}</span>
      <span className="word-row-footer"><StatusBadge status={entry.status} /><span className="row-category"><i style={{ background: entry.categoryColor }} />{entry.categoryName}</span></span>
    </button>
  )
}

function StatusBadge({ status }: { status: EnrichmentStatus }): ReactElement {
  return <span className={`status-badge ${statusTone[status]}`}>{status === 'processing' && <LoaderCircle size={12} className="spin" />}{statusCopy[status]}</span>
}

function MorphemeCard({ match }: { match: RootMatch }): ReactElement {
  const detailParts = [
    match.surfaceForm !== match.root ? `词中形式 ${match.surfaceForm}` : '',
    match.matchedVia === 'lemma' ? '按原形匹配' : '',
    match.source === 'dictionary' ? match.sourceLabel : ''
  ].filter(Boolean)
  const content = <>
    <span className="root-card-top"><code lang="en">{match.root}</code>{match.source === 'dictionary' && match.sourceAnchor && <ExternalLink size={14} />}</span>
    <span className="morpheme-meta"><span>{morphemeKindCopy[match.kind]}</span><span>{match.source === 'dictionary' ? '本地辞典' : 'AI 解析'}</span></span>
    <strong>{match.meaning}</strong>
    {match.formationNote && <p>{match.formationNote}</p>}
    {detailParts.length > 0 && <small>{detailParts.join(' · ')}</small>}
  </>
  if (match.source === 'dictionary' && match.sourceAnchor) {
    return <button className="root-card" data-source="dictionary" onClick={() => void window.api.roots.openSource(match.sourceAnchor)} aria-label={`在本地辞典中查看${morphemeKindCopy[match.kind]} ${match.root}`}>{content}</button>
  }
  return <div className="root-card" data-source="ai">{content}</div>
}

function PhraseAnalysis({ entry, onOpenEntry, onCollectEntry, onRetry }: { entry: WordEntry; onOpenEntry: (word: string) => void; onCollectEntry: (word: string) => void; onRetry: () => void }): ReactElement {
  const [linkedEntries, setLinkedEntries] = useState<Record<string, WordEntry | null>>({})

  useEffect(() => {
    let active = true
    void Promise.all(entry.phraseComponents.map(async (component) => [
      component.text.toLocaleLowerCase('en-US'),
      await window.api.words.getByNormalized(component.text)
    ] as const)).then((links) => {
      if (active) setLinkedEntries(Object.fromEntries(links))
    })
    return () => { active = false }
  }, [entry.id, entry.phraseComponents])

  return <section className="form-section phrase-analysis">
    <div className="section-title"><div><p className="eyebrow">短语</p><h2>{entry.phraseType || '完整表达'}</h2></div><div className="section-title-actions"><span className="source-label">整体释义</span><button className="outline-button" disabled={entry.status === 'pending' || entry.status === 'processing'} onClick={onRetry}><RefreshCw size={14} />重新分析</button></div></div>
    <p className="phrase-explanation">{entry.phraseExplanation || (entry.status === 'pending' || entry.status === 'processing' ? 'DeepSeek 正在分析这个完整表达。' : '暂无短语组合说明。')}</p>
    <div className="phrase-components">
      <p className="eyebrow">短语组成</p>
      {entry.phraseComponents.length ? entry.phraseComponents.map((component) => {
        const linked = linkedEntries[component.text.toLocaleLowerCase('en-US')]
        const canCollect = !linked && !COMMON_FUNCTION_WORDS.has(component.text.toLocaleLowerCase('en-US'))
        return <div className="phrase-component" key={component.text}>
          <div><code lang="en">{component.text}</code><span>{component.meaningZh}</span></div>
          {linked ? <button className="text-button" onClick={() => onOpenEntry(component.text)}>查看单词</button> : canCollect ? <button className="text-button" onClick={() => onCollectEntry(component.text)}><Plus size={14} />收藏</button> : <span className="component-unlinked">未收藏</span>}
        </div>
      }) : <div className="root-empty">AI 完成后会显示组成词解释。</div>}
    </div>
  </section>
}

function WordDetail({ entry, categories, isTrash, onChanged, onToast, onDirtyChange, onOpenEntry, onCollectEntry }: { entry: WordEntry; categories: Category[]; isTrash: boolean; onChanged: () => void; onToast: (kind: 'success' | 'error', message: string) => void; onDirtyChange: (dirty: boolean) => void; onOpenEntry: (word: string) => void; onCollectEntry: (word: string) => void }): ReactElement {
  const [draft, setDraft] = useState<WordDraft>(() => asDraft(entry))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const latestDraftRef = useRef(draft)
  const editVersionRef = useRef(0)
  const savingRef = useRef(false)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (draft.id !== entry.id || !dirty) {
      const nextDraft = asDraft(entry)
      latestDraftRef.current = nextDraft
      setDraft(nextDraft)
      if (draft.id !== entry.id) {
        editVersionRef.current += 1
        setDirty(false)
        setSaveError(null)
      }
    }
  }, [entry])

  const editDraft = (nextDraft: WordDraft): void => {
    latestDraftRef.current = nextDraft
    editVersionRef.current += 1
    setDraft(nextDraft)
    setDirty(true)
    setSaveError(null)
  }

  const save = async (snapshot: WordDraft, version: number): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const saved = await window.api.words.save(snapshot)
      if (editVersionRef.current === version) {
        const savedDraft = asDraft(saved)
        latestDraftRef.current = savedDraft
        setDraft(savedDraft)
        setDirty(false)
      }
      setSaveError(null)
      onChanged()
    } catch (error) {
      const message = messageOf(error)
      setSaveError(message)
      onToast('error', `自动保存失败：${message}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!dirty || saving || saveError || !canAutosaveDraft(draft)) return
    const timer = window.setTimeout(() => {
      void save(latestDraftRef.current, editVersionRef.current)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [draft, dirty, saveError, saving])

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
    onToast('success', '已恢复词条。')
    onChanged()
  }

  if (isTrash) {
    return (
      <div className="empty-detail trashed-detail">
        <ArchiveRestore size={28} />
        <h2>此词条在回收站中</h2>
        <p>恢复后会回到主词库，原有释义、分析和分类都会保留。</p>
        <button className="primary-button" onClick={() => void restore()}><ArchiveRestore size={17} />恢复词条</button>
      </div>
    )
  }

  return (
    <article className="detail-card">
      <div className="detail-status-line"><StatusBadge status={entry.status} />{entry.entryType === 'phrase' && <span className="entry-type-badge">短语</span>}<span className={`autosave-status${saveError ? ' error' : ''}`}>{saveError ? '自动保存失败' : saving ? '自动保存中…' : dirty ? (canAutosaveDraft(draft) ? '修改待保存' : '填写完整后自动保存') : '已自动保存'}</span></div>
      {entry.aiError && <div className="inline-alert"><CircleAlert size={17} /><span>{entry.aiError}</span><button onClick={() => void retry()}><RefreshCw size={14} />重试</button></div>}

      <section className="form-section word-heading-section">
        <label>词汇<input className="latin-field" lang="en" value={draft.word} onChange={(event) => editDraft({ ...draft, word: event.target.value })} />{draft.word.trim() && entryInputError(draft.word) && <span className="field-error">{entryInputError(draft.word)}</span>}</label>
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

      {entry.entryType === 'phrase' ? <PhraseAnalysis entry={entry} onOpenEntry={onOpenEntry} onCollectEntry={onCollectEntry} onRetry={() => void retry()} /> : <section className="form-section roots-section">
        <div className="section-title"><div><p className="eyebrow">词源</p><h2>词素与构词</h2></div><div className="section-title-actions"><span className="source-label">本地辞典 + AI</span><button className="outline-button" disabled={entry.status === 'pending' || entry.status === 'processing'} onClick={() => void retry()}><RefreshCw size={14} />重新分析</button></div></div>
        {entry.rootMatches.length ? <>
          <div className="morpheme-chain" aria-label={`${entry.word} 的构词链`}>
            <span className="morpheme-parts">{entry.rootMatches.map((match, index) => <span className="morpheme-part" key={`${match.root}-${match.sortOrder}`}><code lang="en">{match.surfaceForm || match.root}</code>{index < entry.rootMatches.length - 1 && <span aria-hidden="true">＋</span>}</span>)}</span>
            <span className="morpheme-arrow" aria-hidden="true">→</span>
            <code className="morpheme-word" lang="en">{entry.word}</code>
          </div>
          {entry.formationSummary && <p className="formation-summary">{entry.formationSummary}</p>}
          <details className="morpheme-details" open>
            <summary>查看词素详情 <span>{entry.rootMatches.length} 个构词成分</span></summary>
            <div className="root-grid">{entry.rootMatches.map((match) => <MorphemeCard key={`${match.root}-${match.sourceAnchor}-${match.sortOrder}`} match={match} />)}</div>
          </details>
        </> : <div className="root-empty"><Tag size={17} />{entry.status === 'pending' || entry.status === 'processing' ? 'DeepSeek 正在分析该词的构词结构。' : '没有足够依据进行可靠拆分。'}</div>}
      </section>}

      <section className="form-section actions-section">
        <div className="detail-actions"><button className="danger-button" onClick={() => void moveToTrash()}><Trash2 size={16} />移入回收站</button></div>
      </section>
    </article>
  )
}

function AddWordDialog({ motionState, onClose, onCreated, onToast }: { motionState: MotionState; onClose: () => void; onCreated: (result: WordCreateResult) => void; onToast: (kind: 'success' | 'error', message: string) => void }): ReactElement {
  const [word, setWord] = useState('')
  const [creating, setCreating] = useState(false)
  const inputError = word.trim() ? entryInputError(word) : null
  const requestClose = (): void => {
    if (!word.trim() || window.confirm('放弃尚未加入词库的词汇？')) onClose()
  }
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setCreating(true)
    try {
      const result = await window.api.words.create(word)
      const corrected = word.trim() !== result.entry.word
      onToast('success', result.duplicate ? '该词汇已存在，已为你打开。' : corrected ? `已自动将输入规范为「${result.entry.word}」，加入待 AI 处理队列。` : '词汇已加入待 AI 处理队列。')
      onCreated(result)
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setCreating(false)
    }
  }
  return <Dialog title="添加词汇" motionState={motionState} onClose={requestClose}><form onSubmit={(event) => void create(event)}><p className="dialog-description">支持单词或最多 8 个英文词组成的短语；DeepSeek 会按整个表达补全释义。</p><label>英文单词或短语<input className="latin-field" lang="en" autoFocus data-initial-focus value={word} onChange={(event) => setWord(event.target.value)} placeholder="例如 elusive 或 welfare check" />{inputError && <span className="field-error">{inputError}</span>}</label><div className="dialog-actions"><button type="button" className="text-button" onClick={requestClose}>取消</button><button className="primary-button" disabled={creating || !word.trim() || Boolean(inputError)}>{creating ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}加入队列</button></div></form></Dialog>
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
  const [reanalysing, setReanalysing] = useState(false)

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

  const reanalyseAll = async (): Promise<void> => {
    if (!window.confirm('重新分析全部词条会逐个调用 DeepSeek；Word 会重新分析词素，Phrase 只重新解释整体表达。继续吗？')) return
    setReanalysing(true)
    try {
      const count = await window.api.queue.reanalyseAll()
      onToast('success', `${count} 个词条已加入后台分析队列。`)
    } catch (error) {
      onToast('error', messageOf(error))
    } finally {
      setReanalysing(false)
    }
  }

  const modelOptions = settings ? [...new Set([settings.deepseekModel, ...(deepseek?.models ?? [])].filter(Boolean))] : []

  return <Dialog title="设置" motionState={motionState} onClose={requestClose} wide>{!settings ? <ListLoading /> : <div className="settings-stack">
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Sparkles size={18} /></span><div><h3>DeepSeek AI</h3><p>{checking ? '正在检查 DeepSeek…' : deepseek?.message ?? '尚未检测 DeepSeek。'}</p></div><span className={`connection-dot ${deepseek?.available ? 'online' : ''}`} /></div><label>API Key<input className="latin-field" type="password" autoComplete="new-password" value={settings.deepseekApiKey} placeholder={settings.hasDeepseekApiKey ? '已安全保存；留空则不修改' : 'sk-…'} onChange={(event) => setSettings({ ...settings, deepseekApiKey: event.target.value, clearDeepseekApiKey: false })} /></label><label>API 地址<input className="latin-field" value={settings.deepseekApiUrl} onChange={(event) => setSettings({ ...settings, deepseekApiUrl: event.target.value })} /></label><label>默认模型<select value={settings.deepseekModel} onChange={(event) => setSettings({ ...settings, deepseekModel: event.target.value })}>{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><div className="setting-buttons"><button className="outline-button" disabled={checking} onClick={() => void checkConnection()}>{checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}检测 DeepSeek</button><button className="outline-button" disabled={reanalysing} onClick={() => void reanalyseAll()}>{reanalysing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}重新分析全部</button><button className="text-button" disabled={!settings.hasDeepseekApiKey && !settings.deepseekApiKey} onClick={() => setSettings({ ...settings, deepseekApiKey: '', hasDeepseekApiKey: false, clearDeepseekApiKey: true })}>清除 API Key</button></div></section>
    <section className="settings-section"><div className="settings-heading"><span className="settings-icon"><Database size={18} /></span><div><h3>词根辞典</h3><p>{rootStatus?.message ?? '正在读取索引状态…'}</p></div></div><label>HTML 文件<input value={settings.dictionaryPath} onChange={(event) => setSettings({ ...settings, dictionaryPath: event.target.value })} /></label><div className="setting-buttons"><button className="outline-button" onClick={() => void chooseDictionary()}>选择文件</button><button className="outline-button" onClick={() => void rebuildIndex()}><RefreshCw size={15} />重建索引{rootStatus?.ready ? ` · ${rootStatus.indexedWords} 词` : ''}</button></div></section>
    <section className="settings-section"><div className="settings-heading"><div className="settings-icon"><GraduationCap size={18} /></div><div><h3>复习</h3><p>每天最多自动加入多少个新词；到期词不受此限制。</p></div></div><label>每日新词上限<input type="number" min="0" max="100" step="1" value={settings.dailyNewLimit} onChange={(event) => setSettings({ ...settings, dailyNewLimit: Math.min(100, Math.max(0, Number.parseInt(event.target.value, 10) || 0)) })} /><span className="setting-hint">范围 0–100；设为 0 只复习到期词。</span></label></section>
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
function ListEmpty({ view, query }: { view: CollectionView; query: string }): ReactElement { return <div className="list-empty">{view === 'trash' ? <Trash2 size={24} /> : <Search size={24} />}<strong>{view === 'trash' ? '回收站是空的' : query ? '没有匹配的词汇' : '还没有词汇'}</strong><span>{view === 'trash' ? '被移除的词条会先保存在这里。' : query ? '换个关键词试试。' : '点击右上角“添加词汇”开始建立词库。'}</span></div> }
function WelcomeEmpty({ onAdd }: { onAdd: () => void }): ReactElement { return <div className="empty-detail"><span className="empty-emblem"><BookOpen size={30} /></span><h2>从第一个词条开始</h2><p>先把不熟悉的单词或短语收进来；AI 会在后台补全整体释义与分析。</p><button className="primary-button" onClick={onAdd}><Plus size={17} />添加词汇</button></div> }

function TrashEmpty(): ReactElement { return <div className="empty-detail"><span className="empty-emblem"><Trash2 size={28} /></span><h2>回收站是空的</h2><p>移入回收站的词条会暂存在这里，你可以逐个恢复或一次清空。</p></div> }

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
