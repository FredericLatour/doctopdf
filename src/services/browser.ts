import { Context, Effect, type Fiber, Layer, Scope, Semaphore } from 'effect'
import { chromium, errors as playwrightErrors } from 'playwright-core'
import { RenderConfig, type RenderSettings } from '../app/config'
import { ConversionError, deadline, RenderTimeout } from '../errors'
import { cancellable } from './cancellation'

export interface BrowserSession {
  isConnected: () => boolean
  render: (html: string, signal: AbortSignal) => Promise<Uint8Array>
  close: () => Promise<void>
}
export type BrowserLauncher = (
  config: RenderSettings,
) => Promise<BrowserSession>

export class Browser extends Context.Service<
  Browser,
  {
    render: (
      html: string,
    ) => Effect.Effect<Uint8Array, ConversionError | RenderTimeout>
  }
>()('doctopdf/Browser') {
  static get layer() {
    return makeBrowserLayer(launchBrowser)
  }
}

export function makeBrowserLayer(launch: BrowserLauncher) {
  return Layer.effect(
    Browser,
    Effect.gen(function* () {
      const config = yield* RenderConfig
      const scope = yield* Scope.Scope
      const gate = yield* Semaphore.make(1)
      let session: BrowserSession | undefined
      let idle: Fiber.Fiber<void, never> | undefined
      let generation = 0
      const close = Effect.suspend(() => {
        const current = session
        session = undefined
        return current
          ? Effect.tryPromise({
              try: current.close,
              catch: (cause) =>
                new ConversionError({ stage: 'browser.close', cause }),
            }).pipe(Effect.orDie, Effect.uninterruptible)
          : Effect.void
      })
      yield* Effect.addFinalizer(() => close)
      const render = (html: string) =>
        gate.withPermit(
          Effect.gen(function* () {
            generation++
            if (idle) {
              yield* Effect.sync(() => idle?.interruptUnsafe())
              idle = undefined
            }
            if (session && !session.isConnected()) yield* close
            // Ownership is recorded inside the uninterruptible acquisition:
            // cancellation must not land between launch completion and assignment.
            const current =
              session ??
              (yield* Effect.tryPromise({
                try: () => launch(config),
                catch: (cause) =>
                  browserFailure(
                    'browser.launch',
                    cause,
                    config.markdownTimeoutMs || 30000,
                  ),
              }).pipe(
                Effect.tap((acquired) =>
                  Effect.sync(() => {
                    session = acquired
                  }),
                ),
                Effect.uninterruptible,
              ))
            return yield* deadline(
              cancellable(
                (signal) => current.render(html, signal),
                (cause) =>
                  browserFailure(
                    'browser.render',
                    cause,
                    config.markdownTimeoutMs,
                  ),
              ),
              'markdown',
              config.markdownTimeoutMs,
            )
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                const expected = ++generation
                if (config.idleMs > 0) {
                  idle = yield* Effect.sleep(config.idleMs).pipe(
                    Effect.andThen(
                      gate.withPermit(
                        Effect.suspend(() =>
                          expected === generation ? close : Effect.void,
                        ),
                      ),
                    ),
                    Effect.catchDefect(() =>
                      Effect.logError('Browser idle cleanup failed'),
                    ),
                    Effect.forkIn(scope),
                  )
                }
              }),
            ),
          ),
        )
      return { render }
    }),
  )
}

async function launchBrowser(config: RenderSettings): Promise<BrowserSession> {
  const server = await chromium.launchServer({
    executablePath: config.chromiumPath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    timeout: config.markdownTimeoutMs || 30000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  })
  // A single owner handles shutdown; a timer escalates stalled graceful closure.
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      const timer = setTimeout(() => {
        void server.kill().catch(() => server.process().kill('SIGKILL'))
      }, config.closeTimeoutMs)
      try {
        await server.close()
      } catch (cause) {
        try {
          await server.kill()
        } catch (cleanup) {
          throw new AggregateError([cause, cleanup], 'Browser shutdown failed')
        }
      } finally {
        clearTimeout(timer)
      }
    })()
    return closing
  }
  try {
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: config.markdownTimeoutMs || 30000,
    })
    return {
      isConnected: () => !closing && browser.isConnected(),
      close,
      render: async (html, signal) => {
        const abort = () => {
          void close().catch(() => undefined)
        }
        signal.addEventListener('abort', abort, { once: true })
        try {
          signal.throwIfAborted()
          const context = await browser.newContext()
          const outcome = await (async () => {
            const page = await context.newPage()
            await page.setContent(html, {
              waitUntil: config.waitUntil,
              timeout: config.markdownTimeoutMs,
            })
            return await page.pdf({ format: 'A4', printBackground: true })
          })().then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          )
          const timer = setTimeout(abort, config.closeTimeoutMs)
          try {
            await context.close()
          } catch (cleanup) {
            if (!outcome.ok)
              throw new AggregateError(
                [outcome.error, cleanup],
                'Rendering and page cleanup failed',
              )
            throw cleanup
          } finally {
            clearTimeout(timer)
          }
          if (!outcome.ok) throw outcome.error
          return outcome.value
        } finally {
          signal.removeEventListener('abort', abort)
          if (closing) await closing
        }
      },
    }
  } catch (error) {
    try {
      await close()
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Browser connection and cleanup failed',
      )
    }
    throw error
  }
}

function browserFailure(stage: string, cause: unknown, timeoutMs: number) {
  return cause instanceof playwrightErrors.TimeoutError
    ? new RenderTimeout({ stage, timeoutMs })
    : new ConversionError({ stage, cause })
}
