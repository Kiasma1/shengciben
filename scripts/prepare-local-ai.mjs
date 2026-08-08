import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, copyFileSync, existsSync, mkdirSync, rmSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'

const MODEL_REVISION = '50968a4468ef4233ed78cd7c3de230dd1d61a56b'
const MODEL_FILE = 'Qwen3-0.6B-Q8_0.gguf'
const MODEL_URL = `https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/${MODEL_REVISION}/${MODEL_FILE}?download=true`
const MODEL_SHA256 = 'e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c'
const RUNTIME_VERSION = 'b8162'
const RUNTIME_FILE = `llama-${RUNTIME_VERSION}-bin-win-cpu-x64.zip`
const RUNTIME_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${RUNTIME_VERSION}/${RUNTIME_FILE}`
const RUNTIME_SHA256 = '00f2063fc3b4030ce0a475b0225ca08f48360da9493baa135261fd9e12d1cf45'
const REQUIRED_RUNTIME_FILES = ['llama-server.exe', 'llama.dll', 'ggml.dll', 'ggml-base.dll', 'libomp140.x86_64.dll']

const root = process.cwd()
const cacheDirectory = path.join(root, 'build', '.local-ai-cache')
const outputDirectory = path.join(root, 'build', 'local-ai')
const licenseDirectory = path.join(root, 'local-ai', 'LICENSES')

async function download(url, destination, expectedSha256) {
  mkdirSync(path.dirname(destination), { recursive: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}: ${url}`)
  const hash = createHash('sha256')
  const file = createWriteStream(destination)
  for await (const chunk of response.body) {
    hash.update(chunk)
    if (!file.write(chunk)) await once(file, 'drain')
  }
  file.end()
  await once(file, 'close')
  const actual = hash.digest('hex')
  if (actual !== expectedSha256) {
    rmSync(destination, { force: true })
    throw new Error(`SHA256 校验失败: ${path.basename(destination)}\n期望: ${expectedSha256}\n实际: ${actual}`)
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function ensureFile(url, destination, expectedSha256) {
  if (existsSync(destination)) {
    const hash = await hashFile(destination)
    if (hash === expectedSha256) return
    rmSync(destination, { force: true })
  }
  await download(url, destination, expectedSha256)
}

function extractRuntime(archive) {
  if (process.platform !== 'win32') throw new Error('Windows runtime 只能在 Windows release build 中解压。')
  const temporaryDirectory = path.join(cacheDirectory, 'runtime-extracted')
  rmSync(temporaryDirectory, { recursive: true, force: true })
  mkdirSync(temporaryDirectory, { recursive: true })
  try {
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${temporaryDirectory.replace(/'/g, "''")}' -Force`
      ], { stdio: 'inherit' })
    } catch {
      execFileSync('unzip', ['-q', '-o', archive, '-d', temporaryDirectory], { stdio: 'inherit' })
    }

    const runtimeFiles = readdirSync(temporaryDirectory).filter((name) => name === 'llama-server.exe' || /\.dll$/i.test(name))
    const missing = REQUIRED_RUNTIME_FILES.filter((name) => !runtimeFiles.includes(name))
    if (missing.length) throw new Error(`llama.cpp runtime 缺少文件: ${missing.join(', ')}`)

    mkdirSync(outputDirectory, { recursive: true })
    for (const name of readdirSync(outputDirectory)) {
      if (/\.(?:exe|dll)$/i.test(name)) unlinkSync(path.join(outputDirectory, name))
    }
    for (const name of runtimeFiles) {
      const source = path.join(temporaryDirectory, name)
      const destination = path.join(outputDirectory, name)
      copyFileSync(source, destination)
      if (statSync(source).size !== statSync(destination).size) throw new Error(`runtime 文件复制不完整: ${name}`)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

async function main() {
  mkdirSync(cacheDirectory, { recursive: true })
  mkdirSync(outputDirectory, { recursive: true })
  const runtimeArchive = path.join(cacheDirectory, RUNTIME_FILE)
  const modelPath = path.join(outputDirectory, MODEL_FILE)
  await ensureFile(RUNTIME_URL, runtimeArchive, RUNTIME_SHA256)
  extractRuntime(runtimeArchive)
  await ensureFile(MODEL_URL, modelPath, MODEL_SHA256)
  if (!existsSync(path.join(outputDirectory, 'llama-server.exe'))) throw new Error('llama-server.exe 未准备成功。')
  const licensesOutput = path.join(outputDirectory, 'licenses')
  mkdirSync(licensesOutput, { recursive: true })
  for (const name of readdirSync(licenseDirectory)) copyFileSync(path.join(licenseDirectory, name), path.join(licensesOutput, name))
  console.log(`Local AI ready: ${MODEL_FILE} (${statSync(modelPath).size} bytes), ${RUNTIME_FILE}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
