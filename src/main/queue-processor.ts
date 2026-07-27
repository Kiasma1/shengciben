import type { AppDatabase } from './database'
import { checkOllama, enrichWithOllama } from './ollama'
import type { RootIndexer } from './root-indexer'

export class QueueProcessor {
  private running = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly rootIndexer: RootIndexer,
    private readonly onChanged: () => void
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.processNext(), 8000)
    void this.processNext()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async processNext(): Promise<void> {
    if (this.running) return
    const task = this.database.nextPendingTask()
    if (!task) return

    this.running = true
    try {
      const settings = this.database.getSettings()
      const connection = await checkOllama(settings.ollamaUrl)
      const model = settings.ollamaModel || connection.models[0]
      if (!connection.available || !model) return

      const entry = this.database.getWord(task.wordId)
      if (!entry) {
        this.database.setTaskStatus(task.taskId, 'completed')
        return
      }

      this.database.setTaskStatus(task.taskId, 'processing')
      this.database.setWordStatus(task.wordId, 'processing')
      this.onChanged()

      const enrichment = await enrichWithOllama({
        url: settings.ollamaUrl,
        model,
        word: entry.word,
        existingCategories: this.database.listCategories().map((category) => category.name)
      })
      this.database.applyEnrichment(task.wordId, enrichment)
      this.database.setRootMatches(task.wordId, await this.rootIndexer.match(entry.word, settings.dictionaryPath))
      this.database.setTaskStatus(task.taskId, 'completed')
    } catch (error) {
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
