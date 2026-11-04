import { type Config, ConfigProvider, Layer, ManagedRuntime } from 'effect'
import { Browser } from '../services/browser'
import { DocumentRenderer } from '../services/document-renderer'
import { DocxRenderer } from '../services/docx-renderer'
import { JobWorkspace } from '../services/job-workspace'
import { MarkdownRenderer } from '../services/markdown-renderer'
import { PdfMerger } from '../services/pdf-merger'
import { ZipReader } from '../services/zip-reader'
import { RenderConfig } from './config'

export function makeAppLayer() {
  const renderers = Layer.mergeAll(
    DocxRenderer.layer,
    MarkdownRenderer.layer.pipe(Layer.provide(Browser.layer)),
    PdfMerger.layer,
    ZipReader.layer,
  )
  return DocumentRenderer.layer.pipe(
    Layer.provide(renderers),
    Layer.provide(JobWorkspace.layer),
    Layer.provideMerge(RenderConfig.layer),
  )
}
export function makeRuntime() {
  return ManagedRuntime.make(
    makeAppLayer().pipe(
      // Explicitly empty settings must be validated, not treated as absent.
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ preserveEmptyStrings: true }),
        ),
      ),
    ),
  )
}
export type AppRuntime = ManagedRuntime.ManagedRuntime<
  DocumentRenderer | RenderConfig,
  Config.ConfigError
>
