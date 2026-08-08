import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AppDatabase } from '../src/main/database.ts'

test('a staged SQLite backup replaces the wordbook on restart and preserves a pre-restore snapshot', async (context) => {
  const currentDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-current-'))
  const sourceDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-source-'))
  context.after(() => {
    rmSync(currentDirectory, { recursive: true, force: true })
    rmSync(sourceDirectory, { recursive: true, force: true })
  })

  const current = new AppDatabase(currentDirectory)
  current.createWord('current')
  const source = new AppDatabase(sourceDirectory)
  source.createWord('restored')
  source.close()

  const staged = await current.stageRestore(source.filePath)
  assert.equal(existsSync(staged.backupPath), true)
  assert.equal(current.listWords()[0]?.word, 'current')
  current.close()

  const pending = AppDatabase.applyPendingRestore(currentDirectory)
  assert.ok(pending)
  const restored = new AppDatabase(currentDirectory)
  assert.equal(restored.listWords()[0]?.word, 'restored')
  restored.close()

  assert.ok(pending.rollbackPath)
  AppDatabase.commitPendingRestore(pending)
  assert.equal(existsSync(pending.rollbackPath), false)
})

test('restore rejects an unrelated or corrupt SQLite file without replacing the current wordbook', async (context) => {
  const currentDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-current-'))
  const unrelatedPath = path.join(currentDirectory, 'unrelated.sqlite')
  context.after(() => rmSync(currentDirectory, { recursive: true, force: true }))

  const unrelated = new Database(unrelatedPath)
  unrelated.exec('CREATE TABLE something_else (value TEXT)')
  unrelated.close()

  const current = new AppDatabase(currentDirectory)
  current.createWord('protected')
  await assert.rejects(() => current.stageRestore(unrelatedPath), /不是有效的生词本/)
  assert.equal(current.listWords()[0]?.word, 'protected')
  current.close()
  assert.equal(AppDatabase.applyPendingRestore(currentDirectory), null)
})

test('restore releases SQLite handles when a wordbook-shaped backup fails migration', async (context) => {
  const currentDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-current-'))
  const malformedPath = path.join(currentDirectory, 'malformed.sqlite')
  context.after(() => rmSync(currentDirectory, { recursive: true, force: true }))

  const malformed = new Database(malformedPath)
  malformed.exec(`
    CREATE TABLE categories (id TEXT PRIMARY KEY);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE words (id TEXT PRIMARY KEY);
  `)
  malformed.close()

  const current = new AppDatabase(currentDirectory)
  current.createWord('protected')
  await assert.rejects(() => current.stageRestore(malformedPath), /no such column|malformed/i)
  assert.equal(current.listWords()[0]?.word, 'protected')
  assert.equal(AppDatabase.hasPendingRestore(currentDirectory), false)
  current.close()
})

test('startup migration failure closes WAL handles and rolls back to the original wordbook', async (context) => {
  const currentDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-current-'))
  const sourceDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-source-'))
  context.after(() => {
    rmSync(currentDirectory, { recursive: true, force: true })
    rmSync(sourceDirectory, { recursive: true, force: true })
  })

  const current = new AppDatabase(currentDirectory)
  current.createWord('original')
  const source = new AppDatabase(sourceDirectory)
  source.createWord('replacement')
  source.close()
  await current.stageRestore(source.filePath)
  current.close()

  const pending = AppDatabase.applyPendingRestore(currentDirectory)
  assert.ok(pending)
  const broken = new Database(pending.livePath)
  broken.pragma('journal_mode = WAL')
  broken.exec('DROP TABLE words; CREATE TABLE words (id TEXT PRIMARY KEY)')
  broken.close()

  assert.throws(() => new AppDatabase(currentDirectory), /no such column: is_deleted/)
  AppDatabase.rollbackPendingRestore(pending)

  const rolledBack = new AppDatabase(currentDirectory)
  assert.equal(rolledBack.listWords()[0]?.word, 'original')
  rolledBack.close()
})

test('cleanup failure after a successful open keeps the restored wordbook usable', async (context) => {
  const currentDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-current-'))
  const sourceDirectory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-source-'))
  context.after(() => {
    rmSync(currentDirectory, { recursive: true, force: true })
    rmSync(sourceDirectory, { recursive: true, force: true })
  })

  const current = new AppDatabase(currentDirectory)
  current.createWord('original')
  const source = new AppDatabase(sourceDirectory)
  source.createWord('replacement')
  source.close()
  await current.stageRestore(source.filePath)
  current.close()

  const pending = AppDatabase.applyPendingRestore(currentDirectory)
  assert.ok(pending?.rollbackPath)
  const restored = new AppDatabase(currentDirectory)
  const lockedRollback = new Database(pending.rollbackPath, { readonly: true, fileMustExist: true })
  assert.throws(() => AppDatabase.commitPendingRestore(pending), /EBUSY|EPERM|permission/i)
  assert.equal(restored.listWords()[0]?.word, 'replacement')

  lockedRollback.close()
  restored.close()
  AppDatabase.commitPendingRestore(pending)
})
