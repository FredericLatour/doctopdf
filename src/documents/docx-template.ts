import type { Buffer } from 'node:buffer'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'

import type { Delimiters } from './schemas'

export interface TemplateOptions {
  delimiters: Delimiters
}

export function fillTemplate(
  template: Buffer,
  variables: Record<string, unknown>,
  options: TemplateOptions,
): Buffer {
  const zip = new PizZip(template)
  const doc = new Docxtemplater(zip, {
    // Library diagnostics may embed template XML and variable values.
    errorLogging: false,
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { ...options.delimiters },
  })

  try {
    doc.render(variables ?? {})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`DOCX template rendering failed: ${message}`, {
      cause: error,
    })
  }

  return doc.getZip().generate({ type: 'nodebuffer' })
}
