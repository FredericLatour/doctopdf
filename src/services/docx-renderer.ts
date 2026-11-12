import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Effect, Layer, Semaphore } from 'effect'
import { fillTemplate } from '../documents/docx-template'
import type { Delimiters } from '../documents/schemas'
import {
  ConversionError,
  deadline,
  type RenderTimeout,
  TemplateError,
  WorkspaceError,
} from '../errors'
import { cancellable } from './cancellation'
import { RenderConfig } from './config'
import { JobWorkspace } from './job-workspace'

export interface DocxInput {
  bytes: Buffer
  variables: Record<string, unknown>
  delimiters: Delimiters
  path: string
  outputDir: string
}

export class DocxRenderer extends Context.Service<
  DocxRenderer,
  {
    render: (
      input: DocxInput,
    ) => Effect.Effect<
      string,
      TemplateError | ConversionError | RenderTimeout | WorkspaceError
    >
  }
>()('doctopdf/DocxRenderer') {
  static layer = Layer.effect(
    DocxRenderer,
    Effect.gen(function* () {
      const config = yield* RenderConfig
      const workspace = yield* JobWorkspace
      const conversions = yield* Semaphore.make(1)
      // Reuse one private profile under the converter's single permit. Creating
      // a fresh profile per job is materially slower for small documents.
      const profile = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), 'doctopdf-lo-profile-')),
          catch: (cause) =>
            new WorkspaceError({
              operation: 'create converter profile',
              cause,
            }),
        }),
        (path) =>
          Effect.tryPromise({
            try: () => rm(path, { recursive: true, force: true }),
            catch: (cause) =>
              new WorkspaceError({
                operation: 'remove converter profile',
                cause,
              }),
          }).pipe(Effect.orDie),
      ).pipe(Effect.orDie)
      return {
        render: (input: DocxInput) =>
          Effect.gen(function* () {
            const bytes = yield* Effect.try({
              try: () =>
                fillTemplate(input.bytes, input.variables, {
                  delimiters: input.delimiters,
                }),
              catch: (cause) =>
                new TemplateError({
                  message: 'DOCX template rendering failed',
                  cause,
                }),
            })
            yield* workspace.write(input.path, bytes)
            return yield* conversions.withPermit(
              deadline(
                cancellable(
                  (signal) =>
                    convertDocxToPdf(
                      input.path,
                      input.outputDir,
                      signal,
                      profile,
                    ),
                  (cause) =>
                    new ConversionError({ stage: 'libreoffice', cause }),
                ),
                'libreoffice',
                config.docxTimeoutMs,
              ),
            )
          }).pipe(Effect.withSpan('docx.render')),
      }
    }),
  )
}

export async function convertDocxToPdf(
  docxPath: string,
  outputDir: string,
  signal: AbortSignal,
  profileDirectory: string,
): Promise<string> {
  // A separate profile prevents soffice forwarding work to an unrelated process.
  const profile = pathToFileURL(profileDirectory).href
  await runConversion(
    [
      'soffice',
      `-env:UserInstallation=${profile}`,
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      docxPath,
    ],
    signal,
  )
  const pdfPath = join(outputDir, `${parse(docxPath).name}.pdf`)
  await access(pdfPath)
  return pdfPath
}

/** Own the process group so timeout/disconnect also terminates soffice.bin.
 * Both pipes are consumed immediately; diagnostics are capped in memory.
 */
export function runConversion(
  command: string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const executable = command[0]
    if (!executable) throw new Error('Missing conversion executable')
    const child = spawn(executable, command.slice(1), {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let escalation: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, signal)
      } catch (error) {
        if (
          !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
        )
          child.kill(signal)
      }
    }
    const abort = () => {
      kill('SIGTERM')
      escalation = setTimeout(() => kill('SIGKILL'), 1000)
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8192)
        stderr += chunk.toString().slice(0, 8192 - stderr.length)
    })
    let spawnError: Error | undefined
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code) => {
      clearTimeout(escalation)
      signal.removeEventListener('abort', abort)
      // The leader may exit before descendants. Kill the remaining group on abort.
      if (signal.aborted) {
        kill('SIGKILL')
        reject(signal.reason)
      } else if (spawnError) reject(spawnError)
      else if (code !== 0)
        reject(new Error(`LibreOffice conversion failed (${code}): ${stderr}`))
      else resolve()
    })
    if (signal.aborted) abort()
  })
}
