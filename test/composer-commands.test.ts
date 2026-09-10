import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureCompactCommand,
  commandTakesArguments,
  ensureSessionCommands,
  isCommandDraft,
  isCompactCommandDraft,
  isNewSessionCommandDraft,
  isReloadCommandDraft,
} from '../src/features/composer/composer-utils.ts'

test('detects only slash commands exposed by Pi', () => {
  const commands = [{ name: 'agent' }, { name: 'session-name' }]
  assert.equal(isCommandDraft('/agent frontend', commands), true)
  assert.equal(isCommandDraft('  /SESSION-NAME demo', commands), true)
  assert.equal(isCommandDraft('/unknown', commands), false)
  assert.equal(isCommandDraft('agent', commands), false)
})

test('detects /compact with no arguments', () => {
  assert.equal(isCompactCommandDraft('/compact'), true)
  assert.equal(isCompactCommandDraft('  /compact  '), true)
})

test('rejects /compact with trailing arguments', () => {
  assert.equal(isCompactCommandDraft('/compact foo'), false)
  assert.equal(isCompactCommandDraft('/compact '), true) // selectSlashCommand appends a space
})

test('detects /new and /clear without arguments', () => {
  assert.equal(commandTakesArguments({ name: 'new' }), false)
  assert.equal(commandTakesArguments({ name: 'clear' }), false)
  assert.equal(commandTakesArguments({ name: 'compact' }), false)
  assert.equal(commandTakesArguments({ name: 'agent' }), true)
  assert.equal(isNewSessionCommandDraft('/new'), true)
  assert.equal(isNewSessionCommandDraft('  /CLEAR  '), true)
  assert.equal(isNewSessionCommandDraft('/new now'), false)
  assert.equal(isNewSessionCommandDraft('/clear now'), false)
})

test('detects /reload without arguments', () => {
  assert.equal(isReloadCommandDraft('/reload'), true)
  assert.equal(isReloadCommandDraft('  /RELOAD  '), true)
  assert.equal(isReloadCommandDraft('/reload extensions'), false)
})

test('rejects unrelated input', () => {
  assert.equal(isCompactCommandDraft(''), false)
  assert.equal(isCompactCommandDraft('/agent'), false)
  assert.equal(isCompactCommandDraft('compact'), false)
})

test('prepends compact command when absent', () => {
  const result = ensureCompactCommand([{ name: 'agent' }])
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'compact')
  assert.equal(result[1].name, 'agent')
})

test('does not duplicate compact command when Pi already exposes it', () => {
  const result = ensureCompactCommand([{ name: 'compact' }, { name: 'agent' }])
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'compact')
  assert.equal(result[1].name, 'agent')
})

test('handles empty command list', () => {
  const result = ensureCompactCommand([])
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'compact')
})

test('adds local session commands without duplicating Pi commands', () => {
  const result = ensureSessionCommands([{ name: 'new' }, { name: 'agent' }])
  assert.deepEqual(result.map((command) => command.name), ['clear', 'reload', 'new', 'agent'])
})

test('does not duplicate /reload when Pi exposes it', () => {
  const result = ensureSessionCommands([{ name: 'reload' }, { name: 'agent' }])
  assert.deepEqual(result.map((command) => command.name), ['new', 'clear', 'reload', 'agent'])
})
