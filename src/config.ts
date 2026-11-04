import { Context, Layer } from 'effect'
import { z } from 'zod'
import { type DelimiterDefaults, loadDelimiterDefaults } from './delimiters'

const nonnegative = z.coerce.number().int().min(0).max(2_147_483_647)
const settings = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  FORMDATA_TIMEOUT_MS: nonnegative.default(30000),
  MARKDOWN_TIMEOUT_MS: nonnegative.default(30000),
  MARKDOWN_CLOSE_TIMEOUT_MS: nonnegative.min(1).default(5000),
  MARKDOWN_IDLE_MS: nonnegative.default(0),
  MARKDOWN_MAX_CHARS: nonnegative.default(0),
  MARKDOWN_WAIT_UNTIL: z
    .enum(['load', 'domcontentloaded', 'networkidle'])
    .default('domcontentloaded'),
  MARKDOWN_DEBUG: z.string().optional(),
  CHROMIUM_PATH: z.string().optional(),
  MERGE_TIMEOUT_MS: nonnegative.default(30000),
  DOCX_TIMEOUT_MS: nonnegative.min(1).default(60000),
  SHUTDOWN_TIMEOUT_MS: nonnegative.min(1).default(10000),
})

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
  delimiterDefaults?: DelimiterDefaults,
) {
  const env = settings.parse(environment)
  return {
    port: env.PORT,
    formDataTimeoutMs: env.FORMDATA_TIMEOUT_MS,
    markdownTimeoutMs: env.MARKDOWN_TIMEOUT_MS,
    closeTimeoutMs: env.MARKDOWN_CLOSE_TIMEOUT_MS,
    idleMs: env.MARKDOWN_IDLE_MS,
    maxChars: env.MARKDOWN_MAX_CHARS,
    waitUntil: env.MARKDOWN_WAIT_UNTIL,
    markdownDebug: env.MARKDOWN_DEBUG === '1',
    chromiumPath: env.CHROMIUM_PATH || undefined,
    mergeTimeoutMs: env.MERGE_TIMEOUT_MS,
    docxTimeoutMs: env.DOCX_TIMEOUT_MS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    delimiters: delimiterDefaults ?? loadDelimiterDefaults(environment),
  }
}
export type RenderSettings = ReturnType<typeof loadConfig>
export class RenderConfig extends Context.Service<
  RenderConfig,
  RenderSettings
>()('doctopdf/RenderConfig') {
  static layer = (settings: RenderSettings) =>
    Layer.succeed(RenderConfig, settings)
}
