import type { AppDatabase } from './database'
import type { AiProviderRegistry } from './ai-provider'
import type { QueueStatus } from '../shared/types'

export class QueueProcessor {
  private readonly database: AppDatabase
  private readonly providers: AiProviderRegistry
  private readonly onChanged: () => void
  private running = false
  private paused = false
  private timer: NodeJS.Timeout | null = null

  constructor(database: AppDatabase, providers: AiProviderRegistry, onChanged: () => void) {
    this.database = database
    this.providers = providers
    this.onChanged = onChanged
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
      const provider = this.providers.get(settings.aiProvider)
      const connection = await provider.check(settings)
      if (!connection.available || (!settings.ollamaModel && !connection.models.length)) return
      if (!this.database.isTaskPending(task.taskId)) return

      const entry = this.database.getWord(task.wordId)
      if (!entry) {
        this.database.setTaskStatus(task.taskId, 'completed')
        return
      }

      this.database.setTaskStatus(task.taskId, 'processing')
      this.database.setWordStatus(task.wordId, 'processing')
      this.onChanged()

      const enrichment = await provider.enrich({
        settings,
        word: entry.word,
        existingCategories: this.database.listCategories().map((category) => category.name)
      }, connection)
      if (!this.database.isTaskProcessing(task.taskId)) return
      this.database.applyEnrichment(task.wordId, enrichment)
      this.database.setTaskStatus(task.taskId, 'completed')
    } catch (error) {
      if (!this.database.isTaskProcessing(task.taskId)) return
      const message = error instanceof Error ? error.message : 'AI 处理失败。'
      const retryLater = /fetch failed|timed out|abort|network/i.test(message)
      if (retryLater) {
        this.database.setTaskStatus(task.taskId, 'pending')
        this.database.setWordStatus(task.wordId, 'pending')
      } else {
        this.database.setTaskStatus(task.taskId, 'failed', message)
        this.database.setWordFailure(task.wordId, message)
      }
    } finally {
      this.running = false
      this.onChanged()
    }
  }
}
