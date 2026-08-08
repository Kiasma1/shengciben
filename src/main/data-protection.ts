import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface DataProtectionStatus {
  applied: boolean
  message: string
}

export const windowsAclArguments = (directory: string, userSid: string): string[] => [
  directory,
  '/inheritance:r',
  '/grant:r',
  `*${userSid}:(OI)(CI)F`,
  '*S-1-5-18:(OI)(CI)F',
  '*S-1-5-32-544:(OI)(CI)F',
  '/remove:g',
  '*S-1-1-0',
  '*S-1-5-32-545',
  '/L',
  '/Q'
]

export const windowsDescendantAclArguments = (directory: string): string[] => [
  path.join(directory, '*'),
  '/inheritance:e',
  '/remove:g',
  '*S-1-1-0',
  '*S-1-5-32-545',
  '/T',
  '/L',
  '/C',
  '/Q'
]

export const hardenUserDataDirectory = (
  directory: string,
  platform: NodeJS.Platform = process.platform
): DataProtectionStatus => {
  if (platform !== 'win32') return { applied: false, message: '当前平台使用系统默认文件权限。' }
  mkdirSync(directory, { recursive: true })
  try {
    const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const userSid = identity.match(/S-\d+(?:-\d+)+/)?.[0]
    if (!userSid) throw new Error('无法读取当前 Windows 用户 SID。')
    execFileSync('icacls.exe', windowsAclArguments(directory, userSid), {
      stdio: 'ignore',
      windowsHide: true
    })
    if (readdirSync(directory).length > 0) {
      execFileSync('icacls.exe', windowsDescendantAclArguments(directory), {
        stdio: 'ignore',
        windowsHide: true
      })
    }
    return { applied: true, message: '词库目录仅允许当前用户、SYSTEM 和管理员访问。' }
  } catch (error) {
    return {
      applied: false,
      message: error instanceof Error ? `词库目录权限收紧失败：${error.message}` : '词库目录权限收紧失败。'
    }
  }
}
