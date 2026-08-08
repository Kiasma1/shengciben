import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AppDatabase, calculateNextReview, calculateReviewIntervals } from '../src/main/database.ts'
import type { ReviewRating } from '../src/shared/types.ts'

const DAY = 24 * 60

const addReadyWord = (database: AppDatabase, rawWord: string) => {
  const created = database.createWord(rawWord)
  return database.saveWord({
    id: created.entry.id,
    word: created.entry.word,
    ipaUk: 'ɪˈluːsɪv',
    senses: [{ partOfSpeech: 'adj.', definitionZh: '难以捉摸的' }],
    categoryId: created.entry.categoryId,
    tagNames: []
  })
}

const createReadyWord = (rawWord = 'elusive') => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-reviews-'))
  const database = new AppDatabase(directory)
  const entry = addReadyWord(database, rawWord)
  return {
    directory,
    database,
    id: entry.id,
    cleanup: () => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

const updateSchedule = (directory: string, id: string, previousIntervalMinutes: number, reviewCount = 1): void => {
  const reviewedAt = new Date(Date.now() - previousIntervalMinutes * 60_000).toISOString()
  const nextReviewAt = new Date().toISOString()
  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw.prepare('UPDATE words SET last_reviewed_at = ?, next_review_at = ?, review_count = ? WHERE id = ?').run(reviewedAt, nextReviewAt, reviewCount, id)
  raw.close()
}

const eventCount = (directory: string, id: string): number => {
  const raw = new Database(path.join(directory, 'shengciben.sqlite'), { readonly: true })
  const row = raw.prepare('SELECT count(*) AS count FROM review_events WHERE word_id = ?').get(id) as { count: number }
  raw.close()
  return row.count
}

test('new ratings use transparent first-review intervals', () => {
  const cases: { rating: ReviewRating; intervalMinutes: number }[] = [
    { rating: 'again', intervalMinutes: 10 },
    { rating: 'hard', intervalMinutes: DAY },
    { rating: 'good', intervalMinutes: 2 * DAY },
    { rating: 'easy', intervalMinutes: 4 * DAY }
  ]
  for (const { rating, intervalMinutes } of cases) {
    const fixture = createReadyWord(`first-${rating}`)
    try {
      const result = fixture.database.gradeReview(fixture.id, rating)
      assert.equal(result.intervalMinutes, intervalMinutes)
      assert.equal(result.entry.reviewCount, 1)
      assert.equal(eventCount(fixture.directory, fixture.id), 1)
    } finally {
      fixture.cleanup()
    }
  }
})

test('existing intervals use hard, good, easy multipliers and again reset', () => {
  const cases: { rating: ReviewRating; previous: number; expected: number }[] = [
    { rating: 'hard', previous: 60, expected: DAY },
    { rating: 'hard', previous: 2 * DAY, expected: Math.round(2 * DAY * 1.2) },
    { rating: 'good', previous: 3 * DAY, expected: Math.round(3 * DAY * 2.5) },
    { rating: 'easy', previous: 5 * DAY, expected: 5 * DAY * 4 },
    { rating: 'again', previous: 30 * DAY, expected: 10 }
  ]
  for (const { rating, previous, expected } of cases) {
    const fixture = createReadyWord(`existing-${rating}`)
    try {
      updateSchedule(fixture.directory, fixture.id, previous)
      assert.equal(fixture.database.gradeReview(fixture.id, rating).intervalMinutes, expected)
    } finally {
      fixture.cleanup()
    }
  }
})

test('review intervals cap at 365 days', () => {
  assert.equal(calculateReviewIntervals(365 * DAY).easy, 365 * DAY)
  assert.equal(calculateNextReview(365 * DAY, 'easy', new Date('2026-01-01T00:00:00.000Z')).intervalMinutes, 365 * DAY)
})

test('grade updates words and review_events as one durable review result', (context) => {
  const fixture = createReadyWord()
  context.after(fixture.cleanup)

  const result = fixture.database.gradeReview(fixture.id, 'good')
  assert.equal(result.rating, 'good')
  assert.equal(result.intervalMinutes, 2 * DAY)
  assert.ok(Math.abs(Date.parse(result.nextReviewAt) - Date.now() - result.intervalMinutes * 60_000) < 5_000)
  assert.equal(result.entry.reviewCount, 1)
  assert.equal(result.entry.nextReviewAt, result.nextReviewAt)

  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'), { readonly: true })
  const event = raw.prepare('SELECT * FROM review_events WHERE word_id = ?').get(fixture.id) as Record<string, unknown>
  raw.close()
  assert.equal(event.rating, 'good')
  assert.equal(event.interval_minutes, 2 * DAY)
  assert.equal(event.was_new, 1)
  assert.equal(event.previous_next_review_at, null)
})

test('review queue includes all due words and limited eligible new words', (context) => {
  const fixture = createReadyWord('due-first')
  context.after(fixture.cleanup)
  const dueSecond = addReadyWord(fixture.database, 'due-second')
  const future = addReadyWord(fixture.database, 'future-word')
  const newSecond = addReadyWord(fixture.database, 'new-second')
  const noDefinition = fixture.database.createWord('no-definition')
  const trashed = addReadyWord(fixture.database, 'trashed-word')

  fixture.database.saveWord({
    id: dueSecond.id,
    word: dueSecond.word,
    ipaUk: '',
    senses: [{ partOfSpeech: 'noun', definitionZh: '第二个到期词' }],
    categoryId: dueSecond.categoryId,
    tagNames: []
  })
  fixture.database.saveSettings({ ...fixture.database.getSettings(), dailyNewLimit: 1 })
  fixture.database.trashWord(trashed.id)

  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'))
  raw.prepare('UPDATE words SET next_review_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), fixture.id)
  raw.prepare('UPDATE words SET next_review_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), dueSecond.id)
  raw.prepare('UPDATE words SET next_review_at = ? WHERE id = ?').run(new Date(Date.now() + DAY * 60_000).toISOString(), future.id)
  raw.close()

  const overview = fixture.database.getReviewOverview()
  assert.equal(overview.dueCount, 2)
  assert.equal(overview.newCount, 1)
  const queue = fixture.database.getReviewQueue()
  assert.equal(queue.items.length, 3)
  assert.equal(queue.dueCount, 2)
  assert.equal(queue.newCount, 1)
  assert.deepEqual(queue.items.map((item) => item.entry.id), [fixture.id, dueSecond.id, newSecond.id])
  assert.ok(!queue.items.some((item) => item.entry.id === future.id || item.entry.id === noDefinition.entry.id || item.entry.id === trashed.id))
})

test('daily new limit counts local-day new events and zero excludes new words', (context) => {
  const fixture = createReadyWord('daily-first')
  context.after(fixture.cleanup)
  addReadyWord(fixture.database, 'daily-second')
  addReadyWord(fixture.database, 'daily-third')
  fixture.database.saveSettings({ ...fixture.database.getSettings(), dailyNewLimit: 2 })

  assert.equal(fixture.database.getReviewOverview().newCount, 2)
  fixture.database.gradeReview(fixture.id, 'again')
  const afterFirst = fixture.database.getReviewOverview()
  assert.equal(afterFirst.todayNewReviewed, 1)
  assert.equal(afterFirst.newCount, 1)
  assert.equal(fixture.database.getReviewQueue().items.length, 1)

  fixture.database.saveSettings({ ...fixture.database.getSettings(), dailyNewLimit: 0 })
  assert.equal(fixture.database.getReviewOverview().newCount, 0)
  assert.equal(fixture.database.getReviewQueue().items.length, 0)
})

test('review_events cascade when a word is permanently deleted', (context) => {
  const fixture = createReadyWord('cascade')
  context.after(fixture.cleanup)
  fixture.database.gradeReview(fixture.id, 'good')
  fixture.database.trashWord(fixture.id)
  assert.equal(fixture.database.emptyTrash(), 1)
  assert.equal(eventCount(fixture.directory, fixture.id), 0)
})

test('today review counts use local day boundaries', (context) => {
  const fixture = createReadyWord('local-day')
  context.after(fixture.cleanup)
  const localStart = new Date()
  localStart.setHours(0, 0, 0, 0)
  const reviewedAt = new Date(Math.min(Date.now() - 1_000, localStart.getTime() + 60_000)).toISOString()
  const nextReviewAt = new Date(Date.parse(reviewedAt) + DAY * 60_000).toISOString()
  const raw = new Database(path.join(fixture.directory, 'shengciben.sqlite'))
  raw.prepare('INSERT INTO review_events (id, word_id, rating, reviewed_at, previous_next_review_at, next_review_at, interval_minutes, was_new) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('local-event', fixture.id, 'good', reviewedAt, null, nextReviewAt, 2 * DAY, 1)
  raw.prepare('UPDATE words SET last_reviewed_at = ?, next_review_at = ?, review_count = 1 WHERE id = ?').run(reviewedAt, nextReviewAt, fixture.id)
  raw.close()
  const overview = fixture.database.getReviewOverview()
  assert.equal(overview.todayReviewed, 1)
  assert.equal(overview.todayNewReviewed, 1)
})

test('review_events migration creates missing table without resetting existing review fields', (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'shengciben-review-migration-'))
  const first = new AppDatabase(directory)
  const created = first.createWord('legacy-review')
  first.close()
  const raw = new Database(path.join(directory, 'shengciben.sqlite'))
  raw.prepare('UPDATE words SET last_reviewed_at = ?, review_count = ?, next_review_at = ? WHERE id = ?')
    .run('2026-01-01T00:00:00.000Z', 7, '2026-02-01T00:00:00.000Z', created.entry.id)
  raw.exec('DROP TABLE review_events')
  raw.close()

  const reopened = new AppDatabase(directory)
  const entry = reopened.getWord(created.entry.id)
  assert.equal(entry?.reviewCount, 7)
  assert.equal(entry?.lastReviewedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(entry?.nextReviewAt, '2026-02-01T00:00:00.000Z')
  reopened.close()

  const reopenedAgain = new AppDatabase(directory)
  context.after(() => {
    reopenedAgain.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const tables = new Database(path.join(directory, 'shengciben.sqlite'), { readonly: true })
  assert.ok(tables.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_events'").get())
  assert.ok(tables.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_review_events_word_reviewed'").get())
  assert.equal(reopenedAgain.getWord(created.entry.id)?.reviewCount, 7)
  tables.close()
})
