import { BunRuntime } from '@effect/platform-bun'
import { Cause, Effect, Exit } from 'effect'
import { makeAppLayer } from './app/runtime'
import { logFailure } from './errors'
import { startServer } from './http/server'
import { RenderConfig } from './services/config'

const main = Effect.scoped(
  Effect.gen(function* () {
    let hardStop: ReturnType<typeof setTimeout> | undefined
    yield* Effect.addFinalizer(() => Effect.sync(() => clearTimeout(hardStop)))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const config = yield* RenderConfig
        yield* startServer
        // Arm before draining; retain the watchdog through dependency finalizers.
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            hardStop = setTimeout(
              () => {
                console.error('Application cleanup exceeded its deadline')
                process.exit(1)
              },
              config.shutdownTimeoutMs +
                (config.markdownTimeoutMs || 30000) * 2 +
                config.closeTimeoutMs +
                5000,
            )
          }),
        )
        yield* Effect.never
      }),
    ).pipe(Effect.provide(makeAppLayer()))
  }),
).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.sync(() => logFailure('Application failed', cause)),
  ),
)

BunRuntime.runMain(main, {
  disableErrorReporting: true,
  // Preserve the service's successful exit after a clean signal shutdown.
  teardown: (exit, onExit) =>
    onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
})
