import { describe, expect, test } from 'bun:test'
import PizZip from 'pizzip'

import { fillTemplate } from '../../src/template'
import { docxWithDelimiters, fixtureBytes } from '../helpers'

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

  test.each([
    { start: '[[', end: ']]' },
    { start: '<%', end: '%>' },
    { start: '$^(', end: ')|*' },
  ])('renders custom delimiters %j using the native DOCX parser', async (delimiters) => {
    const input = Buffer.from(await docxWithDelimiters(delimiters))
    const output = fillTemplate(
      input,
      { title: 'Custom DOCX Review' },
      { delimiters },
    )
    const xml = new PizZip(output).file('word/document.xml')?.asText()

    expect(xml).toContain('Custom DOCX Review')
    expect(xml).not.toContain(`${delimiters.start}title${delimiters.end}`)
  })

  test('custom delimiters do not change the defaults for later documents', async () => {
    const custom = { start: '[[', end: ']]' }
    fillTemplate(
      Buffer.from(await docxWithDelimiters(custom)),
      { title: 'First' },
      {
        delimiters: custom,
      },
    )
    const output = fillTemplate(
      Buffer.from(await fixtureBytes('simple-template.docx')),
      { title: 'Default still works' },
    )

    expect(new PizZip(output).file('word/document.xml')?.asText()).toContain(
      'Default still works',
    )
  })
})
