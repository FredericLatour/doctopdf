import { Context, Effect, Layer } from 'effect'
import MarkdownIt from 'markdown-it'
import { Browser } from './browser'
import { RenderConfig } from './config'
import { DEFAULT_DELIMITERS } from './delimiters'
import { ConversionError, InvalidInput, type RenderTimeout } from './errors'
import { applyTemplate, loadTheme } from './theme'
import type { Delimiters } from './types'

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})
// Markdown-it 15 disables bare-domain links by default; keep existing output.
markdown.linkify.set({ fuzzyLink: true })

export interface MarkdownTemplateOptions {
  delimiters?: Delimiters
}
export interface MarkdownInput {
  text: string
  variables: Record<string, unknown>
  theme: string
  delimiters: Delimiters
}
export class MarkdownRenderer extends Context.Service<
  MarkdownRenderer,
  {
    render: (
      input: MarkdownInput,
    ) => Effect.Effect<
      Uint8Array,
      InvalidInput | ConversionError | RenderTimeout
    >
  }
>()('doctopdf/MarkdownRenderer') {
  static layer = Layer.effect(
    MarkdownRenderer,
    Effect.gen(function* () {
      const browser = yield* Browser
      const config = yield* RenderConfig
      return {
        render: (input: MarkdownInput) =>
          Effect.gen(function* () {
            if (config.maxChars > 0 && input.text.length > config.maxChars) {
              return yield* Effect.fail(
                new InvalidInput({
                  message: `Markdown length ${input.text.length} exceeds limit ${config.maxChars}`,
                }),
              )
            }
            if (config.markdownDebug)
              yield* Effect.logInfo('Rendering Markdown HTML')
            const html = yield* Effect.tryPromise({
              try: () =>
                renderMarkdownToHtml(input.text, input.variables, input.theme, {
                  delimiters: input.delimiters,
                }),
              catch: (cause) =>
                new ConversionError({ stage: 'markdown.html', cause }),
            })
            return yield* browser.render(html)
          }).pipe(Effect.withSpan('markdown.render')),
      }
    }),
  )
}

export async function renderMarkdownToHtml(
  markdownInput: string,
  variables: Record<string, unknown>,
  theme: string,
  options: MarkdownTemplateOptions = {},
): Promise<string> {
  const { template, css } = await loadTheme(theme)
  const expanded = normalizeMarkdown(
    interpolateMarkdown(
      markdownInput,
      variables,
      options.delimiters ?? DEFAULT_DELIMITERS.markdown,
    ),
  )
  return applyTemplate(
    template,
    { ...variables, content: markdown.render(expanded), styles: css },
    new Set(['content', 'styles']),
  )
}

function interpolateMarkdown(
  input: string,
  variables: Record<string, unknown>,
  delimiters: Delimiters,
): string {
  const pattern = new RegExp(
    `${RegExp.escape(delimiters.start)}\\s*([a-zA-Z0-9_.-]+?)\\s*${RegExp.escape(delimiters.end)}`,
    'g',
  )
  return input.replace(pattern, (_, key: string) => {
    if (!(key in variables)) {
      return ''
    }
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}

function normalizeMarkdown(input: string): string {
  if (input.charCodeAt(0) === 0xfeff) {
    return input.slice(1)
  }
  return input
}
