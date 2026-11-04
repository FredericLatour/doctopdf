import { Config, Context, Layer, Schema } from 'effect'

const nonnegative = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 }),
)
const positive = nonnegative.check(Schema.isGreaterThan(0))
const delimiterPair = Schema.Struct({
  START: Schema.NonEmptyString,
  END: Schema.NonEmptyString,
})
const settings = Config.all({
  port: Config.schema(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
    'PORT',
  ).pipe(Config.withDefault(3000)),
  formDataTimeoutMs: Config.schema(nonnegative, 'FORMDATA_TIMEOUT_MS').pipe(
    Config.withDefault(30000),
  ),
  markdownTimeoutMs: Config.schema(nonnegative, 'MARKDOWN_TIMEOUT_MS').pipe(
    Config.withDefault(30000),
  ),
  closeTimeoutMs: Config.schema(positive, 'MARKDOWN_CLOSE_TIMEOUT_MS').pipe(
    Config.withDefault(5000),
  ),
  idleMs: Config.schema(nonnegative, 'MARKDOWN_IDLE_MS').pipe(
    Config.withDefault(0),
  ),
  maxChars: Config.schema(nonnegative, 'MARKDOWN_MAX_CHARS').pipe(
    Config.withDefault(0),
  ),
  waitUntil: Config.Literals(
    ['load', 'domcontentloaded', 'networkidle'],
    'MARKDOWN_WAIT_UNTIL',
  ).pipe(Config.withDefault('domcontentloaded')),
  markdownDebug: Config.String('MARKDOWN_DEBUG').pipe(
    Config.withDefault(''),
    Config.map((value) => value === '1'),
  ),
  chromiumPath: Config.String('CHROMIUM_PATH').pipe(
    Config.withDefault(''),
    Config.map((value) => value || undefined),
  ),
  mergeTimeoutMs: Config.schema(nonnegative, 'MERGE_TIMEOUT_MS').pipe(
    Config.withDefault(30000),
  ),
  docxTimeoutMs: Config.schema(positive, 'DOCX_TIMEOUT_MS').pipe(
    Config.withDefault(60000),
  ),
  shutdownTimeoutMs: Config.schema(positive, 'SHUTDOWN_TIMEOUT_MS').pipe(
    Config.withDefault(10000),
  ),
  delimiters: Config.all({
    // Struct validation rejects partial pairs; Config.all would default them.
    docx: Config.schema(delimiterPair, ['DOCX', 'DELIMITER']).pipe(
      Config.map(({ START, END }) => ({ start: START, end: END })),
      Config.withDefault({ start: '{', end: '}' }),
    ),
    markdown: Config.schema(delimiterPair, ['MARKDOWN', 'DELIMITER']).pipe(
      Config.map(({ START, END }) => ({ start: START, end: END })),
      Config.withDefault({ start: '{{', end: '}}' }),
    ),
  }),
})

export type RenderSettings = Config.Success<typeof settings>

export class RenderConfig extends Context.Service<
  RenderConfig,
  RenderSettings
>()('doctopdf/RenderConfig') {
  static layer = Layer.effect(RenderConfig, settings)
}
