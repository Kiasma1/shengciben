import { existsSync } from 'node:fs'
import path from 'node:path'

export const LOCAL_AI_MODEL_NAME = 'Qwen3-0.6B'
export const LOCAL_AI_MODEL_FILE = 'Qwen3-0.6B-Q8_0.gguf'

export interface LocalAiResourceContext {
  env?: NodeJS.ProcessEnv
  appPath?: string
  resourcesPath?: string
  isPackaged?: boolean
}

export interface LocalAiResources {
  serverPath: string
  modelPath: string
  bundled: boolean
}

const firstExisting = (candidates: string[]): string => candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]

export const resolveLocalAiResources = (context: LocalAiResourceContext = {}): LocalAiResources => {
  const env = context.env ?? process.env
  const appPath = context.appPath ?? process.cwd()
  const resourcesPath = context.resourcesPath ?? process.resourcesPath ?? appPath
  const packagedRoot = path.join(resourcesPath, 'local-ai')
  const developmentRoots = [path.join(appPath, 'local-ai', 'windows'), path.join(appPath, 'build', 'local-ai'), packagedRoot]
  const roots = context.isPackaged ? [packagedRoot] : developmentRoots
  const serverPath = !context.isPackaged && env.LOCAL_AI_SERVER_PATH
    ? env.LOCAL_AI_SERVER_PATH
    : firstExisting(roots.map((root) => path.join(root, 'llama-server.exe')))
  const modelPath = !context.isPackaged && env.LOCAL_AI_MODEL_PATH
    ? env.LOCAL_AI_MODEL_PATH
    : firstExisting(roots.map((root) => path.join(root, LOCAL_AI_MODEL_FILE)))

  return {
    serverPath,
    modelPath,
    bundled: Boolean(context.isPackaged)
  }
}
