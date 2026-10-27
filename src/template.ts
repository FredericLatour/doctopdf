import type { Buffer } from 'node:buffer'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'

import { DEFAULT_DELIMITERS } from './delimiters'
import type { Delimiters } from './types'

export interface TemplateOptions {
  delimiters?: Delimiters
}

export function fillTemplate(
  template: Buffer,
  variables: Record<string, unknown>,
  options: TemplateOptions = {},
): Buffer {
  const zip = new PizZip(template)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { ...(options.delimiters ?? DEFAULT_DELIMITERS.docx) },
  })

  try {
    doc.render(variables ?? {})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`DOCX template rendering failed: ${message}`)
  }

  return doc.getZip().generate({ type: 'nodebuffer' })
}
