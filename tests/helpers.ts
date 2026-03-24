import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { PDFDocument, StandardFonts } from 'pdf-lib'

export const repoRoot = resolve(import.meta.dir, '..')
export const fixturesDir = join(repoRoot, 'tests', 'fixtures')

export async function createPdfBytes(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  let y = 790
  for (const line of lines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 14,
      font,
    })
    y -= 24
  }

  return pdf.save()
}

export async function writePdf(path: string, lines: string[]) {
  const bytes = await createPdfBytes(lines)
  await writeFile(path, bytes)
}

export async function parsePdfPageCount(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPageCount()
}

export async function makeTempDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function cleanupDir(path: string) {
  await rm(path, { recursive: true, force: true })
}

export function fixtureFile(name: string) {
  return Bun.file(join(fixturesDir, name))
}

export async function fixtureBytes(name: string) {
  return new Uint8Array(await fixtureFile(name).arrayBuffer())
}

export async function fixtureText(name: string) {
  return await fixtureFile(name).text()
}

export async function createZipFromFiles(
  files: Array<{ source: string; pathInZip?: string }>,
  outputPath: string,
) {
  const stagingDir = await makeTempDir('doctopdf-zip-')

  try {
    for (const file of files) {
      const sourcePath = join(fixturesDir, file.source)
      const targetPath = join(
        stagingDir,
        file.pathInZip ?? basename(file.source),
      )
      await mkdir(dirname(targetPath), { recursive: true })
      await Bun.write(targetPath, await readFile(sourcePath))
    }

    const process = Bun.spawn({
      cmd: ['zip', '-X', '-q', '-r', outputPath, '.'],
      cwd: stagingDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const exitCode = await process.exited
    if (exitCode !== 0) {
      const stderr = await new Response(process.stderr).text()
      throw new Error(`zip failed: ${stderr}`)
    }
  } finally {
    await cleanupDir(stagingDir)
  }
}

export async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate port'))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePort(port)
      })
    })
  })
}

export async function waitForHttp(url: string, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // retry
    }

    await Bun.sleep(500)
  }

  throw new Error(`Timed out waiting for ${url}`)
}
