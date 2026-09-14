import assert from 'node:assert/strict'
import test from 'node:test'
import { tabIcon, tabTitle } from '../src/features/workspace/tab-status.ts'

test('tab title leads with exact running and unread counts', () => {
  assert.equal(tabTitle(0, 0, 0), 'Pi Livecraft')
  assert.equal(tabTitle(2, 0, 3), '▶2 · ✓3 - Pi Livecraft')
  assert.equal(tabTitle(0, 2, 0), '⚑2 - Pi Livecraft')
  assert.equal(tabTitle(1, 0, 0), '▶1 - Pi Livecraft')
})

test('favicon shows a static running ring and caps only its unread label', () => {
  const svg = decodeURIComponent(tabIcon(2, 0, 12))
  assert.match(svg, />9\+<\/text>/)
  assert.match(svg, /<circle /)
  assert.doesNotMatch(svg, /rotate|animate/)
  assert.match(decodeURIComponent(tabIcon(1, 0, 0)), /<circle /)
  assert.doesNotMatch(decodeURIComponent(tabIcon(0, 0, 3)), /<circle /)
  assert.match(decodeURIComponent(tabIcon(0, 0, 3)), />3<\/text>/)
  assert.doesNotMatch(tabIcon(0, 0, 0), /text/)
})
