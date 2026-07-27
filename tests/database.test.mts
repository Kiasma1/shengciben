import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AppDatabase } from '../src/main/database.ts'

const createDatabase = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-test-'))
  const database = new AppDatabase(directory)
  return {
    database,
    directory,
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

test('manual save completes the AI task and keeps review state consistent', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Vocabulary')
  const task = fixture.database.nextPendingTask()
  assert.ok(task)
  fixture.database.setTaskStatus(task.taskId, 'processing')
  fixture.database.setWordStatus(created.entry.id, 'processing')

  const saved = fixture.database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: 'vəˈkæbjələri',
    senses: [{ partOfSpeech: 'noun', definitionZh: '词汇' }],
    categoryId: created.entry.categoryId,
    tagNames: ['考试'],
    aiReviewed: true
  })

  assert.equal(saved.status, 'ready')
  assert.equal(saved.aiReviewed, true)
  assert.equal(fixture.database.isTaskProcessing(task.taskId), false)
  assert.equal(fixture.database.nextPendingTask(), null)
  assert.deepEqual(saved.senses.map((sense) => sense.definitionZh), ['词汇'])
})

test('interrupted processing tasks return to pending when the database reopens', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-recovery-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('Resilient')
  const task = first.nextPendingTask()
  assert.ok(task)
  first.setTaskStatus(task.taskId, 'processing')
  first.setWordStatus(created.entry.id, 'processing')
  first.close()

  const reopened = new AppDatabase(directory)
  context.after(() => {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  assert.equal(reopened.nextPendingTask()?.wordId, created.entry.id)
  assert.equal(reopened.getWord(created.entry.id)?.status, 'pending')
})

test('duplicate results expose whether the existing word is in trash', (context) => {
  const fixture = createDatabase()
  context.after(fixture.cleanup)
  const created = fixture.database.createWord('Recoverable')
  fixture.database.trashWord(created.entry.id)

  const duplicate = fixture.database.createWord('recoverable')

  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.entry.id, created.entry.id)
  assert.equal(duplicate.entry.isDeleted, true)
})
