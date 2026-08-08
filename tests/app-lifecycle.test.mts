import assert from 'node:assert/strict'
import test from 'node:test'
import { developmentRendererUrl, shouldKeepRunningAfterMainClose } from '../src/main/app-lifecycle.ts'

test('Windows keeps the app running after the main window closes unless the user quits', () => {
  assert.equal(shouldKeepRunningAfterMainClose({ platform: 'win32', quitting: false }), true)
  assert.equal(shouldKeepRunningAfterMainClose({ platform: 'win32', quitting: true }), false)
  assert.equal(shouldKeepRunningAfterMainClose({ platform: 'darwin', quitting: false }), false)
})

test('packaged builds ignore renderer URL overrides and development only accepts localhost', () => {
  assert.equal(developmentRendererUrl({ candidate: 'https://attacker.example', isPackaged: true }), null)
  assert.equal(developmentRendererUrl({ candidate: 'http://localhost:5173', isPackaged: true }), null)
  assert.equal(developmentRendererUrl({ candidate: 'https://attacker.example', isPackaged: false }), null)
  assert.equal(developmentRendererUrl({ candidate: 'http://127.0.0.1:5173', isPackaged: false }), 'http://127.0.0.1:5173/')
})
