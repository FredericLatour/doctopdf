import { Layer, ManagedRuntime } from 'effect'
import { Browser } from './browser'
import { RenderConfig, type RenderSettings } from './config'
import { DocxRenderer } from './libreoffice'
import { MarkdownRenderer } from './markdown'
import { PdfMerger } from './pdf'
import { DocumentRenderer } from './render'
import { JobWorkspace } from './temp'
import { ZipReader } from './zip'

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
