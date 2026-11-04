import { afterEach } from 'bun:test'
import { basename, join, parse } from 'node:path'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { loadConfig, RenderConfig, type RenderSettings } from '../src/config'
import { createApp } from '../src/index'
import { type DocxInput, DocxRenderer } from '../src/libreoffice'
import { type MarkdownInput, MarkdownRenderer } from '../src/markdown'
import { PdfMerger } from '../src/pdf'
import { DocumentRenderer } from '../src/render'
import { JobWorkspace } from '../src/temp'
import { ZipReader } from '../src/zip'
import { createPdfBytes, writePdf } from './helpers'

const runtimes: ManagedRuntime.ManagedRuntime<DocumentRenderer, never>[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

export function makeTestApp(
  options: {
    config?: RenderSettings
    docx?: DocxRenderer['Service']
    markdown?: MarkdownRenderer['Service']
    workspace?: JobWorkspace['Service']
  } = {},
) {
  const config = options.config ?? loadConfig({})
  const docx = options.docx ?? {
    render: (input: DocxInput) =>
      Effect.promise(async () => {
        const path = join(input.outputDir, `${parse(input.path).name}.pdf`)
        await writePdf(path, [`DOCX:${basename(input.path)}`])
        return path
      }),
  }
  const markdown = options.markdown ?? {
    render: (input: MarkdownInput) =>
      Effect.promise(() => createPdfBytes([`MD:${input.text.trim()}`])),
  }
  const layer = DocumentRenderer.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DocxRenderer, docx),
        Layer.succeed(MarkdownRenderer, markdown),
        PdfMerger.layer,
        ZipReader.layer,
      ),
    ),
    Layer.provide(
      options.workspace
        ? Layer.succeed(JobWorkspace, options.workspace)
        : JobWorkspace.layer,
    ),
    Layer.provide(RenderConfig.layer(config)),
  )
  const runtime = ManagedRuntime.make(layer)
  runtimes.push(runtime)
  return { app: createApp(runtime, config), runtime }
}
