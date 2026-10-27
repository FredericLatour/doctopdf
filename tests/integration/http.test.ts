import { describe, expect, test } from 'bun:test'
import { basename, join, parse } from 'node:path'
import PizZip from 'pizzip'
import { loadDelimiterDefaults } from '../../src/delimiters'
import { type AppDependencies, createApp } from '../../src/index'
import { renderMarkdownToHtml } from '../../src/markdown'
import { mergePdfFiles } from '../../src/pdf'
import { cleanupJob, createJobDirectories } from '../../src/temp'
import { fillTemplate } from '../../src/template'
import { extractZipFiles } from '../../src/zip'
import {
  cleanupDir,
  createPdfBytes,
  createZipFromFiles,
  docxWithDelimiters,
  fixtureBytes,
  fixtureText,
  makeTempDir,
  parsePdfPageCount,
  writePdf,
} from '../helpers'

function makeDependencies(): AppDependencies {
  return {
    createJobDirectories,
    cleanupJob,
    extractZipFiles,
    fillTemplate: (template) => template,
    async convertDocxToPdf(docxPath, outputDir) {
      const outputPath = join(outputDir, `${parse(docxPath).name}.pdf`)
      await writePdf(outputPath, [`DOCX:${basename(docxPath)}`])
      return outputPath
    },
    async renderMarkdownToPdf(markdownInput) {
      return createPdfBytes([`MD:${markdownInput.trim()}`])
    },
    mergePdfFiles,
  }
}

describe('http service', () => {
  test('healthz returns ok', async () => {
    const app = createApp(makeDependencies())
    const response = await app.request('/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  for (const { endpoint, document } of [
    { endpoint: '/render', document: { field: 'cover' } },
    { endpoint: '/render-zip', document: { file: 'cover.docx' } },
  ]) {
    test(`${endpoint} returns 400 for invalid template variables`, async () => {
      const app = createApp(makeDependencies())
      const form = new FormData()
      form.set(
        'manifest',
        JSON.stringify({ variables: [], documents: [document] }),
      )
      form.set('archive', new File([], 'bundle.zip'))

      const response = await app.request(endpoint, {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(400)
      const issues = JSON.parse(await response.text())
      expect(issues[0].path).toEqual(['variables'])
    })

    test(`${endpoint} returns 400 for an empty document list`, async () => {
      const app = createApp(makeDependencies())
      const form = new FormData()
      form.set('manifest', JSON.stringify({ documents: [] }))
      form.set('archive', new File([], 'bundle.zip'))

      const response = await app.request(endpoint, {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(400)
      expect(await response.text()).toContain(
        'At least one document must be provided for rendering',
      )
    })

    test.each([
      { start: '[[' },
      { end: ']]' },
      { start: '', end: ']]' },
      { start: '[[', end: '' },
      { start: 42, end: ']]' },
      null,
    ])(`${endpoint} returns 400 for invalid document delimiters %j`, async (delimiters) => {
      const app = createApp(makeDependencies())
      const form = new FormData()
      form.set(
        'manifest',
        JSON.stringify({ documents: [{ ...document, delimiters }] }),
      )
      form.set('archive', new File([], 'bundle.zip'))

      const response = await app.request(endpoint, {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(400)
      const issues = JSON.parse(await response.text())
      expect(issues[0].path.slice(0, 3)).toEqual(['documents', 0, 'delimiters'])
    })

    test(`${endpoint} renders mixed document and environment delimiters without leaking overrides`, async () => {
      const docxXml: string[] = []
      const markdownHtml: string[] = []
      const deps = makeDependencies()
      const convert = deps.convertDocxToPdf
      deps.fillTemplate = fillTemplate
      deps.convertDocxToPdf = async (docxPath, outputDir) => {
        const zip = new PizZip(await Bun.file(docxPath).arrayBuffer())
        docxXml.push(zip.file('word/document.xml')?.asText() ?? '')
        return convert(docxPath, outputDir)
      }
      deps.renderMarkdownToPdf = async (input, variables, theme, options) => {
        markdownHtml.push(
          await renderMarkdownToHtml(input, variables, theme, options),
        )
        return createPdfBytes(['Markdown page'])
      }
      const app = createApp(deps, {
        delimiterDefaults: loadDelimiterDefaults({
          DOCX_DELIMITER_START: '[',
          DOCX_DELIMITER_END: ']',
          MARKDOWN_DELIMITER_START: '[[',
          MARKDOWN_DELIMITER_END: ']]',
        }),
      })
      const docxEnvironment = { start: '[', end: ']' }
      const docxOverride = { start: '<%', end: '%>' }
      const markdownOverride = { start: '{', end: '}' }
      const files = [
        {
          name: 'environment.docx',
          type: 'docx',
          bytes: await docxWithDelimiters(docxEnvironment),
        },
        {
          name: 'override.docx',
          type: 'docx',
          bytes: await docxWithDelimiters(docxOverride),
          delimiters: docxOverride,
        },
        {
          name: 'environment-again.docx',
          type: 'docx',
          bytes: await docxWithDelimiters(docxEnvironment),
        },
        {
          name: 'environment.md',
          type: 'markdown',
          bytes: new TextEncoder().encode('# [[title]]'),
        },
        {
          name: 'override.md',
          type: 'markdown',
          bytes: new TextEncoder().encode('# {title}'),
          delimiters: markdownOverride,
        },
        {
          name: 'alias.md',
          type: 'md',
          bytes: new TextEncoder().encode('# [[title]]'),
        },
      ]
      const form = new FormData()
      form.set(
        'manifest',
        JSON.stringify({
          variables: { title: 'Configured Review' },
          documents: files.map((file, index) => ({
            ...(endpoint === '/render'
              ? { field: `document${index}` }
              : { file: `docs/${file.name}` }),
            type: file.type,
            delimiters: file.delimiters,
          })),
        }),
      )
      if (endpoint === '/render') {
        for (const [index, file] of files.entries()) {
          form.set(`document${index}`, new File([file.bytes], file.name))
        }
      } else {
        const zip = new PizZip()
        for (const file of files) {
          zip.file(`docs/${file.name}`, file.bytes)
        }
        form.set(
          'archive',
          new File([zip.generate({ type: 'arraybuffer' })], 'bundle.zip'),
        )
      }

      const response = await app.request(endpoint, {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      expect(
        await parsePdfPageCount(new Uint8Array(await response.arrayBuffer())),
      ).toBe(6)
      expect(docxXml).toHaveLength(3)
      for (const xml of docxXml) {
        expect(xml).toContain('Configured Review')
      }
      expect(markdownHtml).toHaveLength(3)
      for (const html of markdownHtml) {
        expect(html).toContain('<h1>Configured Review</h1>')
        expect(html).toContain('<title>Configured Review</title>')
        expect(html).not.toContain('__STYLES__')
      }
    })
  }

  test('render merges docx and markdown inputs', async () => {
    const app = createApp(makeDependencies())
    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        variables: { title: 'Quarterly Review', customerName: 'Acme' },
        outputName: 'Quarterly Review.pdf',
        documents: [
          { field: 'cover', type: 'docx' },
          { field: 'summary', type: 'markdown' },
        ],
      }),
    )
    form.set(
      'cover',
      new File(
        [await fixtureBytes('simple-template.docx')],
        'simple-template.docx',
      ),
    )
    form.set(
      'summary',
      new File([await fixtureText('markdown/simple.md')], 'simple.md', {
        type: 'text/markdown',
      }),
    )

    const response = await app.request('/render', {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(
      'Quarterly_Review.pdf',
    )

    const pageCount = await parsePdfPageCount(
      new Uint8Array(await response.arrayBuffer()),
    )
    expect(pageCount).toBe(2)
  })

  test('render-zip accepts nested archive paths', async () => {
    const app = createApp(makeDependencies())
    const tempDir = await makeTempDir('doctopdf-http-')

    try {
      const zipPath = join(tempDir, 'bundle.zip')
      await createZipFromFiles(
        [
          { source: 'simple-template.docx', pathInZip: 'docs/cover.docx' },
          { source: 'markdown/simple.md', pathInZip: 'docs/summary.md' },
        ],
        zipPath,
      )

      const form = new FormData()
      form.set(
        'manifest',
        JSON.stringify({
          variables: { title: 'Quarterly Review', customerName: 'Acme' },
          documents: [
            { file: 'docs/cover.docx', type: 'docx' },
            { file: 'docs/summary.md', type: 'markdown' },
          ],
        }),
      )
      form.set(
        'archive',
        new File([await Bun.file(zipPath).arrayBuffer()], 'bundle.zip', {
          type: 'application/zip',
        }),
      )

      const response = await app.request('/render-zip', {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      expect(
        await parsePdfPageCount(new Uint8Array(await response.arrayBuffer())),
      ).toBe(2)
    } finally {
      await cleanupDir(tempDir)
    }
  })

  test('render returns 400 when a required part is missing', async () => {
    const app = createApp(makeDependencies())
    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        documents: [{ field: 'cover', type: 'docx' }],
      }),
    )

    const response = await app.request('/render', {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain(
      'Missing DOCX file for field "cover"',
    )
  })
})
