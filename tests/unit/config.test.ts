import { expect, test } from 'bun:test'
import { loadConfig } from '../../src/app/config'

test('validates effective settings once while allowing disabled optional deadlines', () => {
  expect(
    loadConfig({ MARKDOWN_TIMEOUT_MS: '0', MARKDOWN_IDLE_MS: '0' })
      .markdownTimeoutMs,
  ).toBe(0)
  for (const key of [
    'FORMDATA_TIMEOUT_MS',
    'DOCX_TIMEOUT_MS',
    'MERGE_TIMEOUT_MS',
    'MARKDOWN_MAX_CHARS',
  ]) {
    expect(() => loadConfig({ [key]: 'not-a-number' })).toThrow()
    expect(() => loadConfig({ [key]: '-1' })).toThrow()
  }
  expect(() => loadConfig({ DOCX_TIMEOUT_MS: '0' })).toThrow()
  expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: '0' })).toThrow()
  expect(() => loadConfig({ MARKDOWN_WAIT_UNTIL: 'typo' })).toThrow()
})
