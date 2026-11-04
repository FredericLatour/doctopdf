import type { AppRuntime } from '../app/runtime'
import { RenderConfig, type RenderSettings } from '../services/config'
import { createApp } from './app'

export async function startServer(runtime: AppRuntime) {
  let config: RenderSettings
  let server: ReturnType<typeof Bun.serve>
  try {
    config = await runtime.runPromise(RenderConfig)
    const app = createApp(runtime)
    // Rendering can legitimately produce no bytes for longer than Bun's default
    // idle timeout. Body/render deadlines and shutdown own the time budgets.
    server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 })
  } catch (error) {
    await runtime.dispose()
    throw error
  }
  let stopping: Promise<void> | undefined
  const shutdown = () => {
    stopping ??= (async () => {
      const drained = server.stop()
      let forced: Promise<void> | undefined
      const deadline = setTimeout(() => {
        forced = Promise.all([server.stop(true), runtime.dispose()]).then(
          () => undefined,
        )
        // Observe immediately; the same rejection is propagated below.
        void forced.catch(() => undefined)
      }, config.shutdownTimeoutMs)
      try {
        await drained
        await (forced ?? runtime.dispose())
      } finally {
        clearTimeout(deadline)
        await server.stop(true)
      }
    })()
    return stopping
  }
  return { server, shutdown, config }
}
