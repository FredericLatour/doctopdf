import { Effect, Fiber, FiberSet } from 'effect'
import { ServerError } from '../errors'
import { RenderConfig } from '../services/config'
import { createApp, type HttpServices } from './app'

/** Stop intake, drain for the configured period, then close remaining sockets.
 * The surrounding scope interrupts request fibers before releasing services.
 */
export function drainServer(
  server: { stop: (force?: boolean) => Promise<void> },
  timeoutMs: number,
) {
  const stop = (force: boolean) =>
    Effect.tryPromise({
      try: () => server.stop(force),
      catch: (cause) =>
        new ServerError({ operation: force ? 'force-stop' : 'drain', cause }),
    })
  return stop(false).pipe(
    Effect.interruptible,
    Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.void }),
    Effect.ensuring(stop(true).pipe(Effect.orDie)),
  )
}

export const startServer = Effect.gen(function* () {
  const config = yield* RenderConfig
  // Acquired before the server so requests are interrupted after draining,
  // and before the dependency layers release browser/profile resources.
  const requests = yield* FiberSet.make()
  const run = yield* FiberSet.runtime(requests)<HttpServices>()
  const app = createApp({
    runPromiseExit: (effect, options) =>
      Effect.runPromise(Fiber.await(run(effect, options))),
  })
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 }),
      catch: (cause) => new ServerError({ operation: 'listen', cause }),
    }),
    (server) =>
      drainServer(server, config.shutdownTimeoutMs).pipe(Effect.orDie),
  )
})
