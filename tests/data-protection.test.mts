import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hardenUserDataDirectory, windowsAclArguments } from '../src/main/data-protection.ts'

test('Windows data ACL grants only the current user and trusted system principals', () => {
  const args = windowsAclArguments('C:\\data', 'S-1-5-21-1000')
  assert.deepEqual(args.slice(0, 6), [
    'C:\\data',
    '/inheritance:r',
    '/grant:r',
    '*S-1-5-21-1000:(OI)(CI)F',
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F'
  ])
  assert.deepEqual(args.slice(6, 9), ['/remove:g', '*S-1-1-0', '*S-1-5-32-545'])
})

test('Windows data directory hardening succeeds on a temporary directory', { skip: process.platform !== 'win32' }, (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-data-protection-'))
  const databasePath = path.join(directory, 'shengciben.sqlite')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(databasePath, 'existing vocabulary data')
  const result = hardenUserDataDirectory(directory)
  assert.equal(result.applied, true, result.message)
  assert.equal(readFileSync(databasePath, 'utf8'), 'existing vocabulary data')
})
