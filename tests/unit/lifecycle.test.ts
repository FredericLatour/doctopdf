import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { Effect, Exit, Layer, ManagedRuntime } from 'effect'
import { loadConfig, RenderConfig } from '../../src/app/config'
import { ConversionError, deadline } from '../../src/errors'
import {
  Browser,
  type BrowserSession,
  makeBrowserLayer,
} from '../../src/services/browser'
import { cancellable } from '../../src/services/cancellation'
import { runConversion } from '../../src/services/docx-renderer'
import { JobWorkspace } from '../../src/services/job-workspace'

const browsers: ManagedRuntime.ManagedRuntime<Browser, never>[] = []
afterEach(async () => {
  await Promise.all(browsers.splice(0).map((r) => r.dispose()))
})
function browserRuntime(
  launch: () => Promise<BrowserSession>,
  environment: Record<string, string> = {},
) {
  const runtime = ManagedRuntime.make(
    makeBrowserLayer(launch).pipe(
      Layer.provide(RenderConfig.layer(loadConfig(environment))),
    ),
  )
  browsers.push(runtime)
  return runtime
}
function session(
  render: BrowserSession['render'] = async () => new Uint8Array([1]),
) {
  let closed = false
  return {
    isConnected: () => !closed,
    render,
    close: async () => {
      closed = true
    },
  }
}
const render = Browser.use((browser) => browser.render('html'))

describe('browser lifetime', () => {
  test('failed lazy launch can recover on the next request', async () => {
    let attempts = 0
    const runtime = browserRuntime(async () => {
      if (++attempts === 1) throw new Error('launch failed')
      return session()
    })
    expect(attempts).toBe(0)
    expect(Exit.isFailure(await runtime.runPromiseExit(render))).toBe(true)
    expect(await runtime.runPromise(render)).toEqual(new Uint8Array([1]))
    expect(attempts).toBe(2)
  })

  test('concurrent requests share one launch and serialize usage', async () => {
    let launches = 0
    let active = 0
    let peak = 0
    const current = session(async () => {
      peak = Math.max(peak, ++active)
      await Bun.sleep(10)
      active--
      return new Uint8Array([1])
    })
    const runtime = browserRuntime(async () => {
      launches++
      return current
    })
    await Promise.all([runtime.runPromise(render), runtime.runPromise(render)])
    expect(launches).toBe(1)
    expect(peak).toBe(1)
    await runtime.dispose()
    expect(current.isConnected()).toBe(false)
  })

  test('idle shutdown waits until the active render releases the browser', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const current = session(async () => {
      started.resolve()
      await release.promise
      return new Uint8Array()
    })
    const runtime = browserRuntime(async () => current, {
      MARKDOWN_IDLE_MS: '10',
    })
    const task = runtime.runPromise(render)
    await started.promise
    await Bun.sleep(30)
    expect(current.isConnected()).toBe(true)
    release.resolve()
    await task
    await Bun.sleep(40)
    expect(current.isConnected()).toBe(false)
  })

  test('interruption waits for adapter cleanup before completing', async () => {
    const started = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()
    let released = false
    const current = session(async (_html, signal) => {
      started.resolve()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      await cleanup.promise
      released = true
      throw new Error('aborted')
    })
    const runtime = browserRuntime(async () => current)
    const abort = new AbortController()
    let completed = false
    const task = runtime
      .runPromiseExit(render, { signal: abort.signal })
      .then((exit) => {
        completed = true
        return exit
      })
    await started.promise
    abort.abort()
    await Bun.sleep(10)
    expect(completed).toBe(false)
    cleanup.resolve()
    expect(Exit.isFailure(await task)).toBe(true)
    expect(released).toBe(true)
  })

  test('runtime disposal cancels a running render before closing the shared browser', async () => {
    const started = Promise.withResolvers<void>()
    const events: string[] = []
    const runtime = browserRuntime(async () => ({
      isConnected: () => true,
      render: async (_html, signal) => {
        started.resolve()
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        events.push('render stopped')
        return new Uint8Array()
      },
      close: async () => {
        events.push('browser closed')
      },
    }))
    const task = runtime.runPromiseExit(render)
    await started.promise
    await runtime.dispose()
    await task
    expect(events).toEqual(['render stopped', 'browser closed'])
  })
})

describe('workspace lifetime', () => {
  test('removes partial acquisition when creating a child directory fails', async () => {
    const mkdir = spyOn(fs, 'mkdir').mockImplementation(async () => {
      throw new Error('disk unavailable')
    })
    const rm = spyOn(fs, 'rm')
    try {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(JobWorkspace.use((workspace) => workspace.acquire)).pipe(
          Effect.provide(JobWorkspace.layer),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(rm).toHaveBeenCalledTimes(1)
      const path = rm.mock.calls[0]?.[0]
      expect(typeof path).toBe('string')
      if (typeof path === 'string')
        expect(
          await fs.stat(path).then(
            () => true,
            () => false,
          ),
        ).toBe(false)
    } finally {
      mkdir.mockRestore()
      rm.mockRestore()
    }
  })

  test('removes the workspace on interruption', async () => {
    let path = ''
    const ready = Promise.withResolvers<void>()
    const abort = new AbortController()
    const task = Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const workspace = yield* JobWorkspace
          path = (yield* workspace.acquire).base
          ready.resolve()
          yield* Effect.never
        }),
      ).pipe(Effect.provide(JobWorkspace.layer)),
      { signal: abort.signal },
    )
    await ready.promise
    abort.abort()
    await task
    expect(
      await fs.stat(path).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
})

describe('subprocess lifetime', () => {
  test('drains output while the converter is running', async () => {
    await runConversion(
      [
        process.execPath,
        '-e',
        'process.stdout.write("x".repeat(1000000)); process.stderr.write("y".repeat(1000000))',
      ],
      new AbortController().signal,
    )
  })

  test('timeout kills the process group and waits for exit', async () => {
    const dir = await fs.mkdtemp('/tmp/doctopdf-process-')
    const pidFile = `${dir}/pid`
    try {
      const command = [
        process.execPath,
        '-e',
        'await Bun.write(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
        pidFile,
      ]
      const exit = await Effect.runPromiseExit(
        deadline(
          cancellable(
            (signal) => runConversion(command, signal),
            (cause) => new ConversionError({ stage: 'test', cause }),
          ),
          'test',
          150,
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(
          exit.cause.reasons.some(
            (reason) =>
              reason._tag === 'Fail' && reason.error._tag === 'RenderTimeout',
          ),
        ).toBe(true)
      const pid = Number(await fs.readFile(pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

test('late browser acquisition remains owned when disposal interrupts launch', async () => {
  const started = Promise.withResolvers<void>()
  const acquired = Promise.withResolvers<BrowserSession>()
  const current = session()
  const runtime = browserRuntime(async () => {
    started.resolve()
    return acquired.promise
  })
  const task = runtime.runPromiseExit(render)
  await started.promise
  const disposed = runtime.dispose()
  acquired.resolve(current)
  await disposed
  await task
  expect(current.isConnected()).toBe(false)
})
