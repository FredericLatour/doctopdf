import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { RenderConfig } from '../app/config'
import { resolveDocumentDelimiters } from '../documents/delimiters'
import {
  ensureDocxExtension,
  ensurePdfExtension,
  sanitizeFilename,
} from '../documents/filenames'
import type { DocumentDescriptor } from '../documents/schemas'
import { InvalidInput, MissingDocument, type RenderError } from '../errors'
import { DocxRenderer } from './docx-renderer'
import { JobWorkspace } from './job-workspace'
import { MarkdownRenderer } from './markdown-renderer'
import { PdfMerger } from './pdf-merger'
import { normalizeZipPath, ZipReader } from './zip-reader'

export interface InputDocument extends Omit<DocumentDescriptor, 'field'> {
  reference: string
}
export interface RenderInput {
  documents: InputDocument[]
  variables: Record<string, unknown>
  theme: string
  outputName?: string
  source:
    | { kind: 'multipart'; files: Map<string, File> }
    | { kind: 'zip'; archive: Buffer }
}
export interface RenderOutput {
  bytes: Uint8Array
  filename: string
}
export class DocumentRenderer extends Context.Service<
  DocumentRenderer,
  {
    render: (input: RenderInput) => Effect.Effect<RenderOutput, RenderError>
  }
>()('doctopdf/DocumentRenderer') {
  static layer = Layer.effect(
    DocumentRenderer,
    Effect.gen(function* () {
      const config = yield* RenderConfig
      const workspace = yield* JobWorkspace
      const docx = yield* DocxRenderer
      const markdown = yield* MarkdownRenderer
      const pdf = yield* PdfMerger
      const zip = yield* ZipReader
      return {
        render: (input: RenderInput) =>
          Effect.scoped(
            Effect.gen(function* () {
              const job = yield* workspace.acquire
              const archive =
                input.source.kind === 'zip'
                  ? yield* zip.read(
                      input.source.archive,
                      input.documents.map((doc) => doc.reference),
                    )
                  : undefined
              const paths: string[] = []
              for (const [index, spec] of input.documents.entries()) {
                const key =
                  input.source.kind === 'zip'
                    ? normalizeZipPath(spec.reference)
                    : spec.reference
                const file =
                  input.source.kind === 'multipart'
                    ? input.source.files.get(spec.reference)
                    : undefined
                const source =
                  file ?? (key ? archive?.files.get(key) : undefined)
                if (!source)
                  return yield* Effect.fail(
                    new MissingDocument({
                      message:
                        input.source.kind === 'multipart'
                          ? `Missing DOCX file for field "${spec.reference}"`
                          : `Missing file "${spec.reference}" in zip archive`,
                    }),
                  )
                const bytes =
                  source instanceof File
                    ? yield* Effect.tryPromise({
                        try: async () =>
                          Buffer.from(await source.arrayBuffer()),
                        catch: (cause) =>
                          new InvalidInput({
                            message: 'Unable to read uploaded document',
                            cause,
                          }),
                      })
                    : source
                const delimiters = resolveDocumentDelimiters(
                  spec,
                  config.delimiters,
                )
                const name = spec.filename ?? file?.name ?? spec.reference
                const stem = `${index + 1}-${sanitizeFilename(spec.type === 'docx' ? ensureDocxExtension(name) : ensurePdfExtension(name))}`
                yield* Effect.logInfo('Rendering document').pipe(
                  Effect.annotateLogs({
                    documentIndex: index,
                    format: spec.type,
                  }),
                )
                const path = yield* Effect.gen(function* () {
                  if (spec.type === 'docx')
                    return yield* docx.render({
                      bytes,
                      variables: input.variables,
                      delimiters,
                      path: join(job.docx, stem),
                      outputDir: job.pdf,
                    })
                  const rendered = yield* markdown.render({
                    text: bytes.toString('utf8'),
                    variables: input.variables,
                    theme: input.theme,
                    delimiters,
                  })
                  const path = join(job.pdf, stem)
                  yield* workspace.write(path, rendered)
                  return path
                }).pipe(
                  Effect.tapError((error) =>
                    Effect.logError('Document rendering failed').pipe(
                      Effect.annotateLogs({
                        documentIndex: index,
                        format: spec.type,
                        category: error._tag,
                      }),
                    ),
                  ),
                  Effect.withSpan('document.render', {
                    attributes: { documentIndex: index, format: spec.type },
                  }),
                )
                paths.push(path)
              }
              const bytes = yield* pdf.merge(paths)
              return {
                bytes,
                filename: sanitizeFilename(
                  ensurePdfExtension(input.outputName ?? 'document.pdf'),
                ),
              }
            }),
          ).pipe(Effect.withSpan('documents.render')),
      }
    }),
  )
}
