import { ConfigProvider, Layer } from 'effect'
import { Browser } from '../services/browser'
import { RenderConfig } from '../services/config'
import { DocumentRenderer } from '../services/document-renderer'
import { DocxRenderer } from '../services/docx-renderer'
import { JobWorkspace } from '../services/job-workspace'
import { MarkdownRenderer } from '../services/markdown-renderer'
import { PdfMerger } from '../services/pdf-merger'
import { ZipReader } from '../services/zip-reader'

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
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ preserveEmptyStrings: true }),
      ),
    ),
  )
}
