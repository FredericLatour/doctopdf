import {
  type Delimiters,
  DelimitersSchema,
  type DocumentDescriptor,
} from './types'

export interface DelimiterDefaults {
  docx: Delimiters
  markdown: Delimiters
}

export const DEFAULT_DELIMITERS: DelimiterDefaults = {
  docx: { start: '{', end: '}' },
  markdown: { start: '{{', end: '}}' },
}

export function loadDelimiterDefaults(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DelimiterDefaults {
  return {
    docx: loadPair('DOCX', DEFAULT_DELIMITERS.docx, environment),
    markdown: loadPair('MARKDOWN', DEFAULT_DELIMITERS.markdown, environment),
  }
}

export function resolveDocumentDelimiters(
  document: Pick<DocumentDescriptor, 'type' | 'delimiters'>,
  defaults: DelimiterDefaults,
): Delimiters {
  const format = document.type === 'docx' ? 'docx' : 'markdown'
  return document.delimiters ?? defaults[format]
}

function loadPair(
  prefix: 'DOCX' | 'MARKDOWN',
  fallback: Delimiters,
  environment: Readonly<Record<string, string | undefined>>,
): Delimiters {
  const startName = `${prefix}_DELIMITER_START`
  const endName = `${prefix}_DELIMITER_END`
  const start = environment[startName]
  const end = environment[endName]

  if (start === undefined && end === undefined) {
    return { ...fallback }
  }

  const parsed = DelimitersSchema.safeParse({ start, end })
  if (!parsed.success) {
    throw new Error(
      `${startName} and ${endName} must both be set to nonempty strings`,
    )
  }

  return parsed.data
}
