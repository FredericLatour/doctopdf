import { posix as pathPosix } from 'node:path'
import type { Readable } from 'node:stream'
import { Context, type Effect, Layer } from 'effect'
import yauzl from 'yauzl'
import { InvalidArchive } from './errors'
import { cancellable } from './operations'

export interface ZipExtractResult {
  files: Map<string, Buffer>
}
export class ZipReader extends Context.Service<
  ZipReader,
  {
    read: (
      archive: Buffer,
      wantedFiles: string[],
    ) => Effect.Effect<ZipExtractResult, InvalidArchive>
  }
>()('doctopdf/ZipReader') {
  static layer = Layer.succeed(ZipReader, {
    read: (archive, wanted) =>
      cancellable(
        (signal) => extractZipFiles(archive, wanted, signal),
        (cause) =>
          new InvalidArchive({
            message: 'Invalid ZIP archive or entry path',
            cause,
          }),
      ),
  })
}

export async function extractZipFiles(
  archive: Buffer,
  wantedFiles: string[],
  signal?: AbortSignal,
): Promise<ZipExtractResult> {
  const wanted = new Set(
    wantedFiles.map((name) => {
      const normalized = normalizeZipPath(name)
      if (!normalized) throw new Error(`Invalid file path in manifest: ${name}`)
      return normalized
    }),
  )
  signal?.throwIfAborted()
  const zip = await yauzl.fromBufferPromise(archive)
  let active: Readable | undefined
  const abort = () => active?.destroy(new Error('ZIP read interrupted'))
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const files = new Map<string, Buffer>()
    signal?.throwIfAborted()
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted()
      if (entry.fileName.endsWith('/')) continue
      const name = normalizeZipPath(entry.fileName)
      if (!name) throw new Error(`Invalid zip entry path: ${entry.fileName}`)
      if (!wanted.has(name)) continue
      active = await zip.openReadStreamPromise(entry)
      try {
        signal?.throwIfAborted()
        const chunks: Buffer[] = []
        for await (const chunk of active) {
          signal?.throwIfAborted()
          chunks.push(Buffer.from(chunk))
        }
        files.set(name, Buffer.concat(chunks))
      } finally {
        active.destroy()
        active = undefined
      }
    }
    return { files }
  } finally {
    signal?.removeEventListener('abort', abort)
    active?.destroy()
    zip.close()
  }
}

export function normalizeZipPath(value: string): string | null {
  const normalized = pathPosix.normalize(value).replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.includes('..')) return null
  return normalized
}
