import { makeRuntime } from './app/runtime'
import { startServer } from './http/server'

const { shutdown, config } = await startServer(makeRuntime())
let stopping = false
const onSignal = () => {
  if (stopping) return
  stopping = true
  // Last resort for a broken native adapter. Normal shutdown awaits scopes and
  // process termination; it never exits early on the successful path.
  const hardStop = setTimeout(
    () => process.exit(1),
    config.shutdownTimeoutMs +
      (config.markdownTimeoutMs || 30000) * 2 +
      config.closeTimeoutMs +
      5000,
  )
  void shutdown()
    .catch(() => {
      console.error('Shutdown failed')
      process.exitCode = 1
    })
    .finally(() => clearTimeout(hardStop))
}
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)
