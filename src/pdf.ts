import { Context, Effect, Layer } from 'effect'
import { PDFDocument } from 'pdf-lib'
import { RenderConfig } from './config'
import { ConversionError, deadline, type RenderTimeout } from './errors'

export async function mergePdfFiles(paths: string[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const path of paths) {
    const src = await PDFDocument.load(await Bun.file(path).arrayBuffer())
    const pages = await merged.copyPages(src, src.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  return merged.save()
}

export class PdfMerger extends Context.Service<
  PdfMerger,
  {
    merge: (
      paths: string[],
    ) => Effect.Effect<Uint8Array, ConversionError | RenderTimeout>
  }
>()('doctopdf/PdfMerger') {
  static layer = Layer.effect(
    PdfMerger,
    Effect.gen(function* () {
      const config = yield* RenderConfig
      return {
        merge: (paths: string[]) =>
          deadline(
            Effect.tryPromise({
              try: () => mergePdfFiles(paths),
              catch: (cause) => new ConversionError({ stage: 'merge', cause }),
            }).pipe(Effect.uninterruptible),
            'merge',
            config.mergeTimeoutMs,
          ),
      }
    }),
  )
}
