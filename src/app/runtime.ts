import { Layer, ManagedRuntime } from 'effect'
import { Browser } from '../services/browser'
import { DocumentRenderer } from '../services/document-renderer'
import { DocxRenderer } from '../services/docx-renderer'
import { JobWorkspace } from '../services/job-workspace'
import { MarkdownRenderer } from '../services/markdown-renderer'
import { PdfMerger } from '../services/pdf-merger'
import { ZipReader } from '../services/zip-reader'
import { RenderConfig, type RenderSettings } from './config'

export function makeAppLayer(config: RenderSettings) {
  const renderers = Layer.mergeAll(
    DocxRenderer.layer,
    MarkdownRenderer.layer.pipe(Layer.provide(Browser.layer)),
    PdfMerger.layer,
    ZipReader.layer,
  )
  return DocumentRenderer.layer.pipe(
    Layer.provide(renderers),
    Layer.provide(JobWorkspace.layer),
    Layer.provide(RenderConfig.layer(config)),
  )
}
export function makeRuntime(config: RenderSettings) {
  return ManagedRuntime.make(makeAppLayer(config))
}
export type AppRuntime = ManagedRuntime.ManagedRuntime<DocumentRenderer, never>
