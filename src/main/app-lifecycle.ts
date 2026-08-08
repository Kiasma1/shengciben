export const shouldKeepRunningAfterMainClose = ({
  platform,
  quitting
}: {
  platform: NodeJS.Platform
  quitting: boolean
}): boolean => platform === 'win32' && !quitting

export const developmentRendererUrl = ({
  candidate,
  isPackaged
}: {
  candidate?: string
  isPackaged: boolean
}): string | null => {
  if (isPackaged || !candidate) return null
  try {
    const url = new URL(candidate)
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    return localHost && (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : null
  } catch {
    return null
  }
}
