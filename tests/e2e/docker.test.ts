import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  cleanupDir,
  createZipFromFiles,
  fixtureBytes,
  fixtureText,
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

  const exitCode = await process.exited
  const stdout = await new Response(process.stdout).text()
  const stderr = await new Response(process.stderr).text()

  if (exitCode !== 0) {
    throw new Error(`docker ${args.join(' ')} failed:\n${stderr || stdout}`)
  }

  return stdout.trim()
}

async function extractTextWithContainer(pdfPath: string) {
  const fileName = pdfPath.split('/').at(-1)
  if (!fileName) {
    throw new Error(`Invalid pdf path: ${pdfPath}`)
  }

  const containerPath = `/tmp/${fileName}`
  await runDocker(['cp', pdfPath, `${containerName}:${containerPath}`])
  return await runDocker([
    'exec',
    containerName,
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
  }, 120000)

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
})
