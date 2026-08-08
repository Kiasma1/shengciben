import type { AppDatabase } from './database'
import type { AiProvider, AiProviderRegistry } from './ai-provider'
import type { AiMorpheme, QueueStatus, RootMatch } from '../shared/types'

 type MorphemeResolver = (word: string, morphemes: AiMorpheme[]) => Promise<RootMatch[]>

const MAX_TASK_RETRIES = 10

const aiOnlyMorphemes: MorphemeResolver = async (_word, morphemes) => morphemes.map((morpheme, sortOrder) => ({
  root: morpheme.canonicalForm,
  surfaceForm: morpheme.form,
  kind: morpheme.kind,
  meaning: morpheme.meaning,
  formationNote: '',
  source: 'ai',
  sourceAnchor: '',
  sourceLabel: 'AI 解析',
  matchedVia: 'ai',
  sortOrder
}))

export class QueueProcessor {
  private readonly database: AppDatabase
  private readonly providers: AiProviderRegistry
  private readonly onChanged: () => void
  private readonly resolveMorphemes: MorphemeResolver
  private running = false
  private paused = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    database: AppDatabase,
    providers: AiProviderRegistry,
    onChanged: () => void,
    resolveMorphemes: MorphemeResolver = aiOnlyMorphemes
  ) {
    this.database = database
    this.providers = providers
    this.onChanged = onChanged
    this.resolveMorphemes = resolveMorphemes
  }

  start(): void {
    this.timer ??= setInterval(() => void this.processNext(), 8000)
    void this.processNext()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  getStatus(): QueueStatus {
    return this.database.getQueueStatus(this.paused)
  }

  setPaused(paused: boolean): QueueStatus {
    this.paused = paused
    if (!paused) void this.processNext()
    this.onChanged()
    return this.getStatus()
  }

  async processNext(): Promise<void> {
    if (this.running || this.paused) return
    const task = this.database.nextPendingTask()
    if (!task) return

    this.running = true
    try {
      const settings = this.database.getSettings()
      const entry = this.database.getWord(task.wordId)
      if (!entry) {
        this.database.setTaskStatus(task.taskId, 'completed')
        return
      }

      const deepSeekFirst = settings.aiProvider === 'deepseek-first' || (settings.aiProvider === 'auto' && entry.entryType === 'phrase')
      if (deepSeekFirst) {
        try {
          const deepSeekProvider = this.providers.get('deepseek')
          const connection = await deepSeekProvider.check(settings)
          if (connection.available && (settings.deepseekModel || connection.models.length)) {
            await this.runProvider(task.taskId, task.wordId, entry, deepSeekProvider, connection)
            return
          }
        } catch {
          this.resetAfterFallback(task.taskId, task.wordId)
        }
      }

      if (settings.aiProvider !== 'deepseek') {
        const localProvider = this.providers.get('local')
        const localConnection = localProvider.id === 'local' ? await localProvider.check(settings) : { available: false, models: [], message: '本地 AI Provider 未配置。' }
        if (localConnection.available) {
          try {
            await this.runProvider(task.taskId, task.wordId, entry, localProvider, localConnection)
            return
          } catch (error) {
            this.resetAfterFallback(task.taskId, task.wordId)
            if (settings.aiProvider === 'local' || deepSeekFirst) throw error
          }
        }
        if (settings.aiProvider === 'local' || deepSeekFirst) throw new Error(localConnection.message)
      }

      if (settings.aiProvider === 'deepseek' || (settings.aiProvider === 'auto' && entry.entryType === 'word')) {
        const deepSeekProvider = this.providers.get('deepseek')
        const connection = await deepSeekProvider.check(settings)
        if (!connection.available || (!settings.deepseekModel && !connection.models.length)) {
          throw new Error(connection.message || 'DeepSeek 当前不可用。')
        }
        await this.runProvider(task.taskId, task.wordId, entry, deepSeekProvider, connection)
      }
    } catch (error) {
      if (!this.database.isTaskProcessing(task.taskId)) {
        // A manual save or another worker may have completed this task.
        if (!this.database.isTaskPending(task.taskId)) return
        this.database.setTaskStatus(task.taskId, 'processing')
      }
      const message = error instanceof Error ? error.message : 'AI 处理失败。'
      const retryLater = (
        error instanceof Error && 'retryable' in error && error.retryable === true
      ) || /fetch failed|timed out|abort|network/i.test(message)
      if (retryLater) {
        const attempts = this.database.bumpTaskRetry(task.taskId)
        if (attempts >= MAX_TASK_RETRIES) {
          const exhausted = `重试 ${MAX_TASK_RETRIES} 次后仍失败：${message}`
          this.database.setTaskStatus(task.taskId, 'failed', exhausted)
          this.database.setWordFailure(task.wordId, exhausted)
        } else {
          this.database.setTaskStatus(task.taskId, 'pending')
          this.database.setWordStatus(task.wordId, 'pending')
        }
      } else {
        this.database.setTaskStatus(task.taskId, 'failed', message)
        this.database.setWordFailure(task.wordId, message)
      }
    } finally {
      this.running = false
      this.onChanged()
    }
  }

  private async runProvider(
    taskId: string,
    wordId: string,
    entry: NonNullable<ReturnType<AppDatabase['getWord']>>,
    provider: AiProvider,
    connection: Awaited<ReturnType<AiProvider['check']>>
  ): Promise<void> {
    if (!this.database.isTaskPending(taskId)) return
    this.database.setTaskStatus(taskId, 'processing')
    this.database.setWordStatus(wordId, 'processing')
    this.onChanged()

    const enrichment = await provider.enrich({
      settings: this.database.getSettings(),
      word: entry.word,
      entryType: entry.entryType,
      existingCategories: this.database.listCategories().map((category) => category.name)
    }, connection)
    const rootMatches = entry.entryType === 'word'
      ? await this.resolveMorphemes(entry.word, enrichment.morphemes ?? [])
      : []
    if (!this.database.isTaskProcessing(taskId)) return
    this.database.applyEnrichment(wordId, enrichment)
    this.database.setRootMatches(wordId, rootMatches)
    this.database.setTaskStatus(taskId, 'completed')
  }

  private resetAfterFallback(taskId: string, wordId: string): void {
    if (!this.database.isTaskProcessing(taskId)) return
    this.database.setTaskStatus(taskId, 'pending')
    this.database.setWordStatus(wordId, 'pending')
  }

}
