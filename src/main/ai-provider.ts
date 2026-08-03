import type { AiEnrichment, AppSettings, DeepSeekStatus } from '../shared/types'

export interface AiProvider {
  readonly id: AppSettings['aiProvider']
  check(settings: AppSettings): Promise<DeepSeekStatus>
  enrich(
    input: { settings: AppSettings; word: string; existingCategories: string[] },
    status: DeepSeekStatus
  ): Promise<AiEnrichment>
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
