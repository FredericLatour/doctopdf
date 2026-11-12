import { strict as assert } from 'node:assert'
import { readdir, readlink } from 'node:fs/promises'
import { ConfigProvider, Exit, Layer, ManagedRuntime } from 'effect'
import { Browser } from '../../../src/services/browser'
import { RenderConfig } from '../../../src/services/config'

async function chromiumProcesses() {
  const processes: string[] = []
  for (const name of await readdir('/proc')) {
    const exe = await readlink(`/proc/${name}/exe`).catch(() => '')
    if (exe.includes('/chromium/')) processes.push(name)
  }
  return processes
}
const before = new Set(await chromiumProcesses())
const provider = ConfigProvider.fromEnv({
  preserveEmptyStrings: true,
  env: {
    CHROMIUM_PATH: '/usr/bin/chromium',
    MARKDOWN_TIMEOUT_MS: '2000',
    MARKDOWN_CLOSE_TIMEOUT_MS: '100',
    MARKDOWN_IDLE_MS: '100',
  },
})
const runtime = ManagedRuntime.make(
  Browser.layer.pipe(
    Layer.provide(RenderConfig.layer),
    Layer.provide(ConfigProvider.layer(provider)),
  ),
)
const render = (html: string) => Browser.use((browser) => browser.render(html))
try {
  assert((await runtime.runPromise(render('<h1>Warm up</h1>'))).length > 100)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 100)
  try {
    const exit = await runtime.runPromiseExit(
      render('<script>while(true){}</script>'),
      { signal: abort.signal },
    )
    assert(Exit.isFailure(exit))
  } finally {
    clearTimeout(timer)
  }
  assert((await runtime.runPromise(render('<h1>Recovered</h1>'))).length > 100)
  const timeout = await runtime.runPromiseExit(
    render('<script>while(true){}</script>'),
  )
  assert(Exit.isFailure(timeout))
  if (Exit.isFailure(timeout))
    assert(
      timeout.cause.reasons.some(
        (r) => r._tag === 'Fail' && r.error._tag === 'RenderTimeout',
      ),
    )
  assert(
    (await runtime.runPromise(render('<h1>Recovered again</h1>'))).length > 100,
  )
  await Bun.sleep(600)
  assert.deepEqual(
    (await chromiumProcesses()).filter((pid) => !before.has(pid)),
    [],
  )
} finally {
  await runtime.dispose()
}
assert.deepEqual(
  (await chromiumProcesses()).filter((pid) => !before.has(pid)),
  [],
)
console.log('browser cancellation, timeout, recovery and idle cleanup verified')
