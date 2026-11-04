import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import PizZip from 'pizzip'

import {
  cleanupDir,
  createZipFromFiles,
  docxWithDelimiters,
  fixtureBytes,
  fixtureText,
  getFreePort,
  parsePdfPageCount,
  repoRoot,
  waitForHttp,
} from '../helpers'

const imageTag = `doctopdf-test:${Date.now()}`
const containerName = `doctopdf-e2e-${Date.now()}`

const port = Number(process.env.DOCTOPDF_E2E_PORT ?? 38080)
let tempDir = ''

async function runDocker(args: string[]) {
  const process = Bun.spawn({
    cmd: ['docker', ...args],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`docker ${args.join(' ')} failed:\n${stderr || stdout}`)
  }

  return stdout.trim()
}

async function extractTextWithContainer(
  pdfPath: string,
  targetContainer = containerName,
) {
  const fileName = pdfPath.split('/').at(-1)
  if (!fileName) {
    throw new Error(`Invalid pdf path: ${pdfPath}`)
  }

  const containerPath = `/tmp/${fileName}`
  await runDocker(['cp', pdfPath, `${targetContainer}:${containerPath}`])
  return await runDocker([
    'exec',
    targetContainer,
    'pdftotext',
    containerPath,
    '-',
  ])
}

describe('docker e2e', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp('/tmp/doctopdf-e2e-')

    await runDocker(['build', '-t', imageTag, '.'])
    await runDocker([
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '-p',
      `${port}:3000`,
      imageTag,
    ])

    await waitForHttp(`http://127.0.0.1:${port}/healthz`, 60000)
  }, 600000)

  afterAll(async () => {
    try {
      await runDocker(['rm', '-f', containerName])
    } catch {
      // ignore cleanup failures
    }
    await cleanupDir(tempDir)
  })

  test('render returns a merged pdf from docx and markdown fixtures', async () => {
    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        variables: {
          title: 'Quarterly Review',
          subtitle: 'Q1 2026',
          customerName: 'Acme',
        },
        theme: 'default',
        outputName: 'review.pdf',
        documents: [
          { field: 'cover', type: 'docx' },
          { field: 'summary', type: 'markdown' },
        ],
      }),
    )
    form.set(
      'cover',
      new File(
        [await fixtureBytes('multi-field-template.docx')],
        'multi-field-template.docx',
      ),
    )
    form.set(
      'summary',
      new File([await fixtureText('markdown/rich.md')], 'rich.md', {
        type: 'text/markdown',
      }),
    )

    const response = await fetch(`http://127.0.0.1:${port}/render`, {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(await parsePdfPageCount(bytes)).toBeGreaterThanOrEqual(2)

    const pdfPath = join(tempDir, 'render.pdf')
    await writeFile(pdfPath, bytes)

    const text = await extractTextWithContainer(pdfPath)
    expect(text).toContain('Quarterly Review')
    expect(text).toContain('Prepared for Acme')
  }, 120000)

  test('render-zip returns a merged pdf from archive fixtures', async () => {
    const zipPath = join(tempDir, 'bundle.zip')
    await createZipFromFiles(
      [
        { source: 'multi-field-template.docx', pathInZip: 'docs/cover.docx' },
        { source: 'markdown/simple.md', pathInZip: 'docs/summary.md' },
      ],
      zipPath,
    )

    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        variables: {
          title: 'Zip Review',
          customerName: 'Acme',
        },
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

    const response = await fetch(`http://127.0.0.1:${port}/render-zip`, {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(await parsePdfPageCount(bytes)).toBeGreaterThanOrEqual(2)

    const pdfPath = join(tempDir, 'render-zip.pdf')
    await writeFile(pdfPath, bytes)

    const text = await extractTextWithContainer(pdfPath)
    expect(text).toContain('Zip Review')
    expect(text).toContain('Prepared for Acme')
  }, 120000)

  test('render preserves document order in the merged pdf text', async () => {
    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        variables: {
          title: 'DOCX-FIRST-MARKER',
        },
        outputName: 'ordered.pdf',
        documents: [
          { field: 'docxFirst', type: 'docx' },
          { field: 'markdownSecond', type: 'markdown' },
        ],
      }),
    )
    form.set(
      'docxFirst',
      new File(
        [await fixtureBytes('simple-template.docx')],
        'simple-template.docx',
      ),
    )
    form.set(
      'markdownSecond',
      new File(
        [
          '# MARKDOWN-SECOND-MARKER\n\nThis page should come after the DOCX page.\n',
        ],
        'ordered.md',
        { type: 'text/markdown' },
      ),
    )

    const response = await fetch(`http://127.0.0.1:${port}/render`, {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(await parsePdfPageCount(bytes)).toBeGreaterThanOrEqual(2)

    const pdfPath = join(tempDir, 'ordered.pdf')
    await writeFile(pdfPath, bytes)

    const text = await extractTextWithContainer(pdfPath)
    const docxIndex = text.indexOf('DOCX-FIRST-MARKER')
    const markdownIndex = text.indexOf('MARKDOWN-SECOND-MARKER')

    expect(docxIndex).toBeGreaterThanOrEqual(0)
    expect(markdownIndex).toBeGreaterThanOrEqual(0)
    expect(docxIndex).toBeLessThan(markdownIndex)
  }, 120000)

  test('render-zip returns 400 when a manifest file is missing from the archive', async () => {
    const zipPath = join(tempDir, 'bundle-missing-member.zip')
    await createZipFromFiles(
      [{ source: 'multi-field-template.docx', pathInZip: 'docs/cover.docx' }],
      zipPath,
    )

    const form = new FormData()
    form.set(
      'manifest',
      JSON.stringify({
        variables: {
          title: 'Broken Zip Review',
        },
        documents: [
          { file: 'docs/cover.docx', type: 'docx' },
          { file: 'docs/missing.md', type: 'markdown' },
        ],
      }),
    )
    form.set(
      'archive',
      new File([await Bun.file(zipPath).arrayBuffer()], 'bundle.zip', {
        type: 'application/zip',
      }),
    )

    const response = await fetch(`http://127.0.0.1:${port}/render-zip`, {
      method: 'POST',
      body: form,
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain(
      'Missing file "docs/missing.md" in zip archive',
    )
  }, 120000)

  test('environment and document delimiters render through the real pipeline for both endpoints', async () => {
    const configuredContainer = `${containerName}-delimiters`
    const configuredPort = await getFreePort()
    await runDocker([
      'run',
      '--detach',
      '--rm',
      '--name',
      configuredContainer,
      '-p',
      `${configuredPort}:3000`,
      '-e',
      'DOCX_DELIMITER_START=[',
      '-e',
      'DOCX_DELIMITER_END=]',
      '-e',
      'MARKDOWN_DELIMITER_START=[[',
      '-e',
      'MARKDOWN_DELIMITER_END=]]',
      imageTag,
    ])

    try {
      await waitForHttp(`http://127.0.0.1:${configuredPort}/healthz`, 60000)
      const files = [
        {
          name: 'environment.docx',
          type: 'docx',
          bytes: await docxWithDelimiters({ start: '[', end: ']' }),
        },
        {
          name: 'override.docx',
          type: 'docx',
          bytes: await fixtureBytes('simple-template.docx'),
          delimiters: { start: '{', end: '}' },
        },
        {
          name: 'environment.md',
          type: 'markdown',
          bytes: new TextEncoder().encode('# [[customerName]]'),
        },
        {
          name: 'override.md',
          type: 'md',
          bytes: new TextEncoder().encode('# {subtitle}'),
          delimiters: { start: '{', end: '}' },
        },
      ]

      for (const endpoint of ['/render', '/render-zip']) {
        const form = new FormData()
        form.set(
          'manifest',
          JSON.stringify({
            variables: {
              title: 'E2E-CONFIGURED-TITLE',
              customerName: 'MD-ENV-MARKER',
              subtitle: 'MD-OVERRIDE-MARKER',
            },
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

        const response = await fetch(
          `http://127.0.0.1:${configuredPort}${endpoint}`,
          { method: 'POST', body: form },
        )
        expect(response.status).toBe(200)
        const bytes = new Uint8Array(await response.arrayBuffer())
        expect(await parsePdfPageCount(bytes)).toBeGreaterThanOrEqual(4)
        const pdfPath = join(tempDir, `configured-${endpoint.slice(1)}.pdf`)
        await writeFile(pdfPath, bytes)
        const text = await extractTextWithContainer(
          pdfPath,
          configuredContainer,
        )

        expect(text.match(/E2E-CONFIGURED-TITLE/g)).toHaveLength(2)
        expect(text).toContain('MD-ENV-MARKER')
        expect(text).toContain('MD-OVERRIDE-MARKER')
        expect(text).not.toContain('{title}')
        expect(text).not.toContain('[title]')
        expect(text).not.toContain('[[customerName]]')
        expect(text).not.toContain('{subtitle}')
      }
    } finally {
      await runDocker(['rm', '-f', configuredContainer])
    }
  }, 120000)

  test('incomplete environment delimiters stop the service at startup', async () => {
    await expect(
      runDocker(['run', '--rm', '-e', 'DOCX_DELIMITER_START=[[', imageTag]),
    ).rejects.toThrow(
      'DOCX_DELIMITER_START and DOCX_DELIMITER_END must both be set to nonempty strings',
    )
  }, 120000)
  test('real Chromium cancels stalled pages, recovers, and closes when idle', async () => {
    const script = (
      await Bun.file(join(repoRoot, 'tests/e2e/probes/browser.ts')).text()
    ).replaceAll('../../../src/', './src/')
    expect(
      await runDocker(['exec', containerName, 'bun', '--eval', script]),
    ).toContain('verified')
  }, 30000)

  test('real LibreOffice timeout cleans up the process group and workspace', async () => {
    await runDocker([
      'cp',
      join(repoRoot, 'tests/fixtures/simple-template.docx'),
      `${containerName}:/tmp/converter-input.docx`,
    ])
    const script = (
      await Bun.file(join(repoRoot, 'tests/e2e/probes/converter.ts')).text()
    ).replaceAll('../../../src/', './src/')
    expect(
      await runDocker(['exec', containerName, 'bun', '--eval', script]),
    ).toContain('verified')
  }, 15000)

  test('HTTP disconnect stops rendering and removes its workspace', async () => {
    const abort = new AbortController()
    const task = fetch(`http://127.0.0.1:${port}/render`, {
      method: 'POST',
      body: stalledMarkdownForm(),
      signal: abort.signal,
    }).catch(() => undefined)
    try {
      await waitForJobs(containerName, true)
      await Bun.sleep(200)
      abort.abort()
      await task
      await waitForJobs(containerName, false)
      const response = await fetch(`http://127.0.0.1:${port}/render`, {
        method: 'POST',
        body: stalledMarkdownForm('# Recovery'),
      })
      expect(response.status).toBe(200)
      await response.arrayBuffer()
    } finally {
      abort.abort()
      await task
    }
  }, 30000)

  test('SIGTERM interrupts remaining work after the drain deadline and exits cleanly', async () => {
    const name = `${containerName}-shutdown`
    const shutdownPort = await getFreePort()
    const abort = new AbortController()
    let request: Promise<unknown> | undefined
    try {
      await runDocker([
        'run',
        '-d',
        '--name',
        name,
        '-p',
        `${shutdownPort}:3000`,
        '-e',
        'SHUTDOWN_TIMEOUT_MS=100',
        '-e',
        'MARKDOWN_CLOSE_TIMEOUT_MS=100',
        imageTag,
      ])
      await waitForHttp(`http://127.0.0.1:${shutdownPort}/healthz`, 10000)
      request = fetch(`http://127.0.0.1:${shutdownPort}/render`, {
        method: 'POST',
        body: stalledMarkdownForm(),
        signal: abort.signal,
      }).catch(() => undefined)
      await waitForJobs(name, true)
      await runDocker(['kill', '--signal=SIGTERM', name])
      expect(await runDocker(['wait', name])).toBe('0')
      await request
    } finally {
      abort.abort()
      await runDocker(['rm', '-f', name])
      await request
    }
  }, 30000)
})

function stalledMarkdownForm(text = '<script>while(true){}</script>') {
  const form = new FormData()
  form.set(
    'manifest',
    JSON.stringify({ documents: [{ field: 'body', type: 'md' }] }),
  )
  form.set('body', new File([text], 'body.md'))
  return form
}

async function waitForJobs(container: string, present: boolean) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const entries = await runDocker([
      'exec',
      container,
      'bun',
      '--eval',
      "import {readdir} from 'node:fs/promises'; console.log((await readdir('/tmp', {withFileTypes:true})).filter(e=>e.isDirectory() && e.name.startsWith('doctopdf-') && !e.name.startsWith('doctopdf-lo-profile-')).length)",
    ])
    if (Number(entries) > 0 === present) return
    await Bun.sleep(100)
  }
  throw new Error(
    `Job directories did not become ${present ? 'present' : 'empty'}`,
  )
}
