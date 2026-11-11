import { describe, expect, test } from 'bun:test'
import { ConfigProvider, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import { RenderConfig } from '../../src/services/config'
import { testConfig } from '../config'

test('validates numeric bounds while allowing disabled optional deadlines', () => {
  expect(
    testConfig({ MARKDOWN_TIMEOUT_MS: '0', MARKDOWN_IDLE_MS: '0' })
      .markdownTimeoutMs,
  ).toBe(0)
  for (const key of [
    'FORMDATA_TIMEOUT_MS',
    'DOCX_TIMEOUT_MS',
    'MARKDOWN_MAX_CHARS',
  ]) {
    expect(() => testConfig({ [key]: 'not-a-number' })).toThrow()
    expect(() => testConfig({ [key]: '-1' })).toThrow()
  }
  expect(() => testConfig({ DOCX_TIMEOUT_MS: '0' })).toThrow()
  expect(() => testConfig({ SHUTDOWN_TIMEOUT_MS: '0' })).toThrow()
  expect(() => testConfig({ MARKDOWN_WAIT_UNTIL: 'typo' })).toThrow()
  expect(testConfig({ PORT: '0' }).port).toBe(0)
  expect(testConfig({ PORT: '65535' }).port).toBe(65535)
  for (const port of ['-1', '65536', '1.5']) {
    expect(() => testConfig({ PORT: port })).toThrow()
  }
  expect(() => testConfig({ FORMDATA_TIMEOUT_MS: '2147483648' })).toThrow()
  expect(() => testConfig({ MARKDOWN_CLOSE_TIMEOUT_MS: '0' })).toThrow()
})

test('retains debug flag and optional Chromium path semantics', () => {
  expect(testConfig().markdownDebug).toBe(false)
  expect(testConfig({ MARKDOWN_DEBUG: '1' }).markdownDebug).toBe(true)
  expect(testConfig({ MARKDOWN_DEBUG: 'true' }).markdownDebug).toBe(false)
  expect(testConfig().chromiumPath).toBeUndefined()
  expect(testConfig({ CHROMIUM_PATH: '' }).chromiumPath).toBeUndefined()
  expect(testConfig({ CHROMIUM_PATH: '/usr/bin/chromium' }).chromiumPath).toBe(
    '/usr/bin/chromium',
  )
})

test('configuration failures stay in the typed Effect error channel', () => {
  const exit = Effect.runSyncExit(
    RenderConfig.pipe(
      Effect.provide(RenderConfig.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({
          env: { PORT: 'invalid' },
          preserveEmptyStrings: true,
        }),
      ),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toHaveLength(1)
    const reason = exit.cause.reasons[0]
    expect(reason?._tag).toBe('Fail')
    if (reason?._tag === 'Fail') {
      expect(reason.error._tag).toBe('ConfigError')
      expect(reason.error.message).toContain('PORT')
    }
  }
})

test('the runtime shares one configuration snapshot', async () => {
  const environment = { PORT: '3001' }
  const runtime = ManagedRuntime.make(
    RenderConfig.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: environment,
            preserveEmptyStrings: true,
          }),
        ),
      ),
    ),
  )
  try {
    const first = await runtime.runPromise(RenderConfig)
    environment.PORT = '3002'
    const second = await runtime.runPromise(RenderConfig)
    expect(first.port).toBe(3001)
    expect(second).toBe(first)
  } finally {
    await runtime.dispose()
  }
})

describe('delimiter configuration', () => {
  test('keeps the existing defaults when no environment settings are present', () => {
    expect(testConfig({}).delimiters).toEqual({
      docx: { start: '{', end: '}' },
      markdown: { start: '{{', end: '}}' },
    })
  })

  test('configures each format independently', () => {
    expect(
      testConfig({
        DOCX_DELIMITER_START: '[',
        DOCX_DELIMITER_END: ']',
      }).delimiters,
    ).toEqual({
      docx: { start: '[', end: ']' },
      markdown: { start: '{{', end: '}}' },
    })
    expect(
      testConfig({
        MARKDOWN_DELIMITER_START: '[[',
        MARKDOWN_DELIMITER_END: ']]',
      }).delimiters,
    ).toEqual({
      docx: { start: '{', end: '}' },
      markdown: { start: '[[', end: ']]' },
    })
  })

  for (const prefix of ['DOCX', 'MARKDOWN']) {
    test.each([
      ['missing end', { start: '[[', end: undefined }],
      ['missing start', { start: undefined, end: ']]' }],
      ['empty start', { start: '', end: ']]' }],
      ['empty end', { start: '[[', end: '' }],
      ['empty pair', { start: '', end: '' }],
    ])(`rejects ${prefix} configuration with %s`, (_name, pair) => {
      expect(() =>
        testConfig({
          [`${prefix}_DELIMITER_START`]: pair.start,
          [`${prefix}_DELIMITER_END`]: pair.end,
        }),
      ).toThrow(`${prefix}_DELIMITER_START and ${prefix}_DELIMITER_END`)
    })
  }
})
