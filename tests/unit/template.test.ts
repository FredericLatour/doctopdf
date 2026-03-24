import { describe, expect, test } from 'bun:test'
import PizZip from 'pizzip'

import { fillTemplate } from '../../src/template'
import { fixtureBytes } from '../helpers'

describe('fillTemplate', () => {
  test('renders the simple docx fixture', async () => {
    const input = Buffer.from(await fixtureBytes('simple-template.docx'))
    const output = fillTemplate(input, { title: 'Quarterly Review' })

    const zip = new PizZip(output)
    const documentXml = zip.file('word/document.xml')?.asText()

    expect(documentXml).toContain('Quarterly Review')
    expect(documentXml).not.toContain('{title}')
  })

  test('renders multiple fields in the docx fixture', async () => {
    const input = Buffer.from(await fixtureBytes('multi-field-template.docx'))
    const output = fillTemplate(input, {
      title: 'Quarterly Review',
      subtitle: 'Q1 2026',
      customerName: 'Acme',
    })

    const zip = new PizZip(output)
    const documentXml = zip.file('word/document.xml')?.asText()

    expect(documentXml).toContain('Quarterly Review')
    expect(documentXml).toContain('Q1 2026')
    expect(documentXml).toContain('Prepared for Acme')
  })
})
