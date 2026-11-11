import { Context, Effect, Layer } from 'effect'
import { PDFDocument } from 'pdf-lib'
import { ConversionError } from '../errors'

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
    merge: (paths: string[]) => Effect.Effect<Uint8Array, ConversionError>
  }
>()('doctopdf/PdfMerger') {
  static layer = Layer.succeed(PdfMerger, {
    // pdf-lib cannot be interrupted. Await it before workspace cleanup.
    merge: (paths: string[]) =>
      Effect.tryPromise({
        try: () => mergePdfFiles(paths),
        catch: (cause) => new ConversionError({ stage: 'merge', cause }),
      }).pipe(Effect.uninterruptible),
  })
}
