import { describe, expect, test } from 'bun:test'
import { join, parse } from 'node:path'
import { Effect, Exit } from 'effect'
import PizZip from 'pizzip'
import { fillTemplate } from '../../src/documents/docx-template'
import { ConversionError, InvalidInput, RenderTimeout } from '../../src/errors'
import { DocumentRenderer } from '../../src/services/document-renderer'
import { renderMarkdownToHtml } from '../../src/services/markdown-renderer'
import { makeTestApp } from '../app'
import { testConfig } from '../config'
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

describe('http service', () => {
  test('healthz returns ok', async () => {
    const { app } = makeTestApp()
    const response = await app.request('/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  for (const { endpoint, document } of [
    { endpoint: '/render', document: { field: 'cover' } },
    { endpoint: '/render-zip', document: { file: 'cover.docx' } },
  ]) {
    test(`${endpoint} returns 400 for invalid template variables`, async () => {
      const { app } = makeTestApp()
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
      const { app } = makeTestApp()
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
    ])(
      `${endpoint} returns 400 for invalid document delimiters %j`,
      async (delimiters) => {
        const { app } = makeTestApp()
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
        expect(issues[0].path.slice(0, 3)).toEqual([
          'documents',
          0,
          'delimiters',
        ])
      },
    )

    test(`${endpoint} renders mixed document and environment delimiters without leaking overrides`, async () => {
      const docxXml: string[] = []
      const markdownHtml: string[] = []
      const { app } = makeTestApp({
        docx: {
          render: (input) =>
            Effect.promise(async () => {
              const bytes = fillTemplate(input.bytes, input.variables, {
                delimiters: input.delimiters,
              })
              const zip = new PizZip(bytes)
              docxXml.push(zip.file('word/document.xml')?.asText() ?? '')
              const path = join(
                input.outputDir,
                `${parse(input.path).name}.pdf`,
              )
              await writePdf(path, ['DOCX page'])
              return path
            }),
        },
        markdown: {
          render: (input) =>
            Effect.promise(async () => {
              markdownHtml.push(
                await renderMarkdownToHtml(
                  input.text,
                  input.variables,
                  input.theme,
                  { delimiters: input.delimiters },
                ),
              )
              return createPdfBytes(['Markdown page'])
            }),
        },
        config: testConfig({
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
    const { app } = makeTestApp()
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
    const { app } = makeTestApp()
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
    const { app } = makeTestApp()
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

describe('HTTP failure boundary', () => {
  test('maps infrastructure failures to 500 without exposing causes', async () => {
    const { app } = makeTestApp({
      markdown: {
        render: () =>
          Effect.fail(
            new ConversionError({
              stage: 'browser',
              cause: new Error('private template value'),
            }),
          ),
      },
    })
    const response = await app.request('/render', {
      method: 'POST',
      body: markdownForm(),
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"message":"Unexpected server error"}')
  })
  test('maps typed timeouts to 504', async () => {
    const { app } = makeTestApp({
      markdown: {
        render: () =>
          Effect.fail(new RenderTimeout({ stage: 'markdown', timeoutMs: 10 })),
      },
    })
    const response = await app.request('/render', {
      method: 'POST',
      body: markdownForm(),
    })
    expect(response.status).toBe(504)
  })
  test('maps malformed archives to 400', async () => {
    const { app } = makeTestApp()
    const form = new FormData()
    form.set('manifest', JSON.stringify({ documents: [{ file: 'a.docx' }] }))
    form.set('archive', new File(['invalid'], 'bundle.zip'))
    const response = await app.request('/render-zip', {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(400)
  })
  test('cancels body consumption on timeout', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const { app } = makeTestApp({
      config: testConfig({ FORMDATA_TIMEOUT_MS: '10' }),
    })
    const response = await app.request('/render', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    })
    expect(response.status).toBe(504)
    expect(cancelled).toBe(true)
  })
  test('distinguishes interruption from invalid input', async () => {
    const started = Promise.withResolvers<void>()
    let finalized = false
    const { app } = makeTestApp({
      markdown: {
        render: () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                finalized = true
              }),
            ),
          ),
      },
    })
    const abort = new AbortController()
    const task = app.request('/render', {
      method: 'POST',
      body: markdownForm(),
      signal: abort.signal,
    })
    await started.promise
    abort.abort()
    expect((await task).status).toBe(499)
    expect(finalized).toBe(true)
  })
  test('cleanup failure retains the original failure in the cause', async () => {
    const original = new InvalidInput({ message: 'original' })
    const cleanup = new Error('cleanup')
    const { runtime } = makeTestApp({
      workspace: {
        acquire: Effect.acquireRelease(
          Effect.succeed({ base: '/unused', docx: '/unused', pdf: '/unused' }),
          () => Effect.die(cleanup),
        ),
        write: () => Effect.void,
      },
      markdown: { render: () => Effect.fail(original) },
    })
    const exit = await runtime.runPromiseExit(
      DocumentRenderer.use((renderer) =>
        renderer.render({
          variables: {},
          theme: 'default',
          documents: [{ reference: 'body', type: 'md' }],
          source: {
            kind: 'multipart',
            files: new Map([['body', new File(['hello'], 'body.md')]]),
          },
        }),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(
        exit.cause.reasons.some(
          (r) =>
            (r._tag === 'Fail' && r.error === original) ||
            (r._tag === 'Die' && r.defect === original),
        ),
      ).toBe(true)
      expect(
        exit.cause.reasons.some(
          (r) => r._tag === 'Die' && r.defect === cleanup,
        ),
      ).toBe(true)
    }
  })
})

function markdownForm() {
  const form = new FormData()
  form.set(
    'manifest',
    JSON.stringify({ documents: [{ field: 'body', type: 'md' }] }),
  )
  form.set('body', new File(['# Hello'], 'body.md'))
  return form
}
