import { afterEach } from 'bun:test'
import { basename, join, parse } from 'node:path'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { createApp } from '../src/http/app'
import { RenderConfig, type RenderSettings } from '../src/services/config'
import { DocumentRenderer } from '../src/services/document-renderer'
import { type DocxInput, DocxRenderer } from '../src/services/docx-renderer'
import { JobWorkspace } from '../src/services/job-workspace'
import {
  type MarkdownInput,
  MarkdownRenderer,
} from '../src/services/markdown-renderer'
import { PdfMerger } from '../src/services/pdf-merger'
import { ZipReader } from '../src/services/zip-reader'
import { testConfig } from './config'
import { createPdfBytes, writePdf } from './helpers'

const runtimes: ManagedRuntime.ManagedRuntime<
  DocumentRenderer | RenderConfig,
  never
>[] = []
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
  const config = options.config ?? testConfig({})
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
    Layer.provideMerge(Layer.succeed(RenderConfig, config)),
  )
  const runtime = ManagedRuntime.make(layer)
  runtimes.push(runtime)
  return { app: createApp(runtime), runtime }
}
