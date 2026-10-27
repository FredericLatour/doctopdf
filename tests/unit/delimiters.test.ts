import { describe, expect, test } from 'bun:test'

import {
  loadDelimiterDefaults,
  resolveDocumentDelimiters,
} from '../../src/delimiters'

describe('delimiter configuration', () => {
  test('keeps the existing defaults when no environment settings are present', () => {
    expect(loadDelimiterDefaults({})).toEqual({
      docx: { start: '{', end: '}' },
      markdown: { start: '{{', end: '}}' },
    })
  })

  test('configures each format independently', () => {
    expect(
      loadDelimiterDefaults({
        DOCX_DELIMITER_START: '[',
        DOCX_DELIMITER_END: ']',
      }),
    ).toEqual({
      docx: { start: '[', end: ']' },
      markdown: { start: '{{', end: '}}' },
    })
    expect(
      loadDelimiterDefaults({
        MARKDOWN_DELIMITER_START: '[[',
        MARKDOWN_DELIMITER_END: ']]',
      }),
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
        loadDelimiterDefaults({
          [`${prefix}_DELIMITER_START`]: pair.start,
          [`${prefix}_DELIMITER_END`]: pair.end,
        }),
      ).toThrow(
        `${prefix}_DELIMITER_START and ${prefix}_DELIMITER_END must both be set to nonempty strings`,
      )
    })
  }

  test.each([
    'docx',
    'markdown',
    'md',
  ] as const)('document overrides take priority for %s without affecting other documents', (type) => {
    const defaults = loadDelimiterDefaults({
      DOCX_DELIMITER_START: '[',
      DOCX_DELIMITER_END: ']',
      MARKDOWN_DELIMITER_START: '[[',
      MARKDOWN_DELIMITER_END: ']]',
    })
    const override = { start: '<%', end: '%>' }

    expect(
      resolveDocumentDelimiters({ type, delimiters: override }, defaults),
    ).toEqual(override)
    expect(resolveDocumentDelimiters({ type }, defaults)).toEqual(
      type === 'docx' ? { start: '[', end: ']' } : { start: '[[', end: ']]' },
    )
  })
})
