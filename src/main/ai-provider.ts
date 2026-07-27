import type { AiEnrichment, AppSettings, OllamaStatus } from '../shared/types'
import { checkOllama, enrichWithOllama } from './ollama'

export interface AiProvider {
  readonly id: AppSettings['aiProvider']
  check(settings: AppSettings): Promise<OllamaStatus>
  enrich(
    input: { settings: AppSettings; word: string; existingCategories: string[] },
    status: OllamaStatus
  ): Promise<AiEnrichment>
}

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama'

  check(settings: AppSettings): Promise<OllamaStatus> {
    return checkOllama(settings.ollamaUrl)
  }

  enrich(
    input: { settings: AppSettings; word: string; existingCategories: string[] },
    status: OllamaStatus
  ): Promise<AiEnrichment> {
    const model = input.settings.ollamaModel || status.models[0]
    if (!status.available || !model) throw new Error('Ollama 当前不可用或没有可用模型。')
    return enrichWithOllama({
      url: input.settings.ollamaUrl,
      model,
      word: input.word,
      existingCategories: input.existingCategories
    })
  }
}

export class AiProviderRegistry {
  private readonly providers: Map<AppSettings['aiProvider'], AiProvider>

  constructor(providers: AiProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]))
  }

  get(id: AppSettings['aiProvider']): AiProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`未配置 AI Provider：${id}`)
    return provider
  }
}
