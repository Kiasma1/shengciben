import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import type { EntryType, LocalAiStatus } from '../shared/types'
import { LOCAL_AI_MODEL_NAME, resolveLocalAiResources, type LocalAiResourceContext, type LocalAiResources } from './local-ai-resources.ts'

export class LocalAiError extends Error {
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = 'LocalAiError'
  }
}

export interface LocalAiServiceOptions {
  resourceContext?: LocalAiResourceContext
  fetcher?: typeof fetch
  spawnProcess?: typeof spawn
  portPicker?: () => Promise<number>
  healthTimeoutMs?: number
  requestTimeoutMs?: number
  pollIntervalMs?: number
}

const findAvailablePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      reject(new Error('无法分配本地 AI 端口。'))
      return
    }
    const port = address.port
    server.close((error) => error ? reject(error) : resolve(port))
  })
})

export const localAiServerArgs = (resources: LocalAiResources, port: number): string[] => [
  '--model', resources.modelPath,
  '--host', '127.0.0.1',
  '--port', String(port),
  '--ctx-size', '4096',
  '--jinja',
  '--parallel', '1'
]

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class LocalAiService {
  private readonly resources: LocalAiResources
  private readonly fetcher: typeof fetch
  private readonly spawnProcess: typeof spawn
  private readonly portPicker: () => Promise<number>
  private readonly healthTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly pollIntervalMs: number
  private child: ChildProcess | null = null
  private port: number | null = null
  private ready = false
  private state: LocalAiStatus['state'] = 'not_started'
  private lastError = ''
  private diagnostics: string[] = []
  private startPromise: Promise<void> | null = null

  constructor(options: LocalAiServiceOptions = {}) {
    this.resources = resolveLocalAiResources(options.resourceContext)
    this.fetcher = options.fetcher ?? fetch
    this.spawnProcess = options.spawnProcess ?? spawn
    this.portPicker = options.portPicker ?? findAvailablePort
    this.healthTimeoutMs = options.healthTimeoutMs ?? 30_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000
    this.pollIntervalMs = options.pollIntervalMs ?? 250
  }

  status(): LocalAiStatus {
    if (!existsSync(this.resources.serverPath) || !existsSync(this.resources.modelPath)) {
      return {
        state: 'error',
        message: '本地 AI 资源不可用，请检查安装包或开发环境路径。',
        modelName: LOCAL_AI_MODEL_NAME,
        bundled: this.resources.bundled
      }
    }
    if (this.state === 'error') {
      return { state: 'error', message: this.lastError || '本地 AI 不可用。', modelName: LOCAL_AI_MODEL_NAME, bundled: this.resources.bundled }
    }
    if (this.ready) return { state: 'available', message: '本地 AI 可用。', modelName: LOCAL_AI_MODEL_NAME, bundled: this.resources.bundled }
    if (this.state === 'preparing') return { state: 'preparing', message: '正在准备本地 AI…', modelName: LOCAL_AI_MODEL_NAME, bundled: this.resources.bundled }
    return { state: 'not_started', message: '本地 AI 尚未启动。', modelName: LOCAL_AI_MODEL_NAME, bundled: this.resources.bundled }
  }

  async start(): Promise<void> {
    if (this.ready) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '本地 AI 启动失败。'
        this.stop()
        this.state = 'error'
        this.lastError = message
        throw error instanceof LocalAiError ? error : new LocalAiError(message)
      })
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  async check(): Promise<LocalAiStatus> {
    return this.status()
  }

  async complete(input: { word: string; entryType: EntryType; systemPrompt: string }): Promise<string> {
    let restarted = false
    while (true) {
      try {
        await this.start()
        return await this.request(input)
      } catch (error) {
        const message = error instanceof Error ? error.message : '本地 AI 请求失败。'
        this.stop()
        if (restarted) {
          this.state = 'error'
          this.lastError = message
          throw error instanceof LocalAiError ? error : new LocalAiError(message)
        }
        restarted = true
      }
    }
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.port = null
    this.ready = false
    this.state = 'not_started'
    if (child && !child.killed) child.kill()
  }

  diagnosticsSnapshot(): string[] {
    return [...this.diagnostics]
  }

  private async startInternal(): Promise<void> {
    if (!existsSync(this.resources.serverPath) || !existsSync(this.resources.modelPath)) {
      throw new LocalAiError('本地 AI 资源不可用，请检查安装包或开发环境路径。')
    }
    if (this.child && this.ready && !this.child.killed && this.port) return

    this.state = 'preparing'
    this.lastError = ''
    const port = await this.portPicker()
    const fullArgs = localAiServerArgs(this.resources, port)
    const args = [fullArgs[0], path.basename(this.resources.modelPath), ...fullArgs.slice(2)]
    const child = this.spawnProcess(this.resources.serverPath, args, {
      cwd: path.dirname(this.resources.modelPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    this.port = port
    const record = (chunk: Buffer | string): void => {
      const message = String(chunk).trim()
      if (!message) return
      this.diagnostics.push(message.slice(-4096))
      if (this.diagnostics.length > 20) this.diagnostics.shift()
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.once('error', (error) => {
      this.lastError = error.message
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null
        this.port = null
        this.ready = false
        this.state = 'error'
        this.lastError = `本地 AI 进程已退出（${signal ?? code ?? 'unknown'}）。`
      }
    })

    const deadline = Date.now() + this.healthTimeoutMs
    while (Date.now() < deadline) {
      if (this.child !== child) throw new LocalAiError(this.lastError || '本地 AI 进程启动失败。')
      try {
        const response = await this.fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(this.pollIntervalMs * 2) })
        if (response.ok) {
          this.ready = true
          this.state = 'available'
          return
        }
      } catch {
        // llama-server may need several polls while loading the GGUF.
      }
      await wait(this.pollIntervalMs)
    }
    throw new LocalAiError('本地 AI 启动超时。')
  }

  private async request(input: { word: string; entryType: EntryType; systemPrompt: string }): Promise<string> {
    if (!this.port) throw new LocalAiError('本地 AI 尚未准备好。')
    const response = await this.fetcher(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      body: JSON.stringify({
        model: LOCAL_AI_MODEL_NAME,
        stream: false,
        temperature: 0.2,
        top_p: 0.8,
        max_tokens: input.entryType === 'phrase' ? 300 : 180,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: `${input.word} /no_think` }
        ]
      })
    })
    if (!response.ok) throw new LocalAiError(`本地 AI 请求失败（${response.status}）。`)
    const payload = (await response.json()) as { choices?: { message?: { content?: string | null } }[] }
    const content = payload.choices?.[0]?.message?.content?.trim()
    if (!content) throw new LocalAiError('本地 AI 没有返回内容。')
    return content
  }
}
