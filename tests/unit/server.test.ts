import { expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { drainServer } from '../../src/http/server'

for (const rejects of [false, true]) {
  test(`drain ${rejects ? 'failure' : 'success'} still stops sockets and releases dependencies`, async () => {
    const events: string[] = []
    const failure = new Error('drain failed')
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push('services released')
            }),
          )
          yield* Effect.acquireRelease(Effect.void, () =>
            drainServer(
              {
                stop: async (force) => {
                  events.push(force ? 'force stop' : 'drain')
                  if (!force && rejects) throw failure
                },
              },
              100,
            ).pipe(Effect.orDie),
          )
        }),
      ),
    )
    expect(events).toEqual(['drain', 'force stop', 'services released'])
    expect(Exit.isFailure(exit)).toBe(rejects)
  })
}

test('drain deadline works inside an uninterruptible scope finalizer', async () => {
  let forced = false
  await Effect.runPromise(
    Effect.scoped(
      Effect.acquireRelease(Effect.void, () =>
        drainServer(
          {
            stop: (force) => {
              if (force) {
                forced = true
                return Promise.resolve()
              }
              return new Promise<void>(() => {})
            },
          },
          10,
        ).pipe(Effect.orDie),
      ),
    ),
  )
  expect(forced).toBe(true)
}, 1000)

test('startup failure and cleanup failure are both retained', async () => {
  const startup = new Error('listen failed')
  const cleanup = new Error('cleanup failed')
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.die(cleanup))
        return yield* Effect.fail(startup)
      }),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(
      exit.cause.reasons.some(
        (r) =>
          (r._tag === 'Fail' && r.error === startup) ||
          (r._tag === 'Die' && r.defect === startup),
      ),
    ).toBe(true)
    expect(
      exit.cause.reasons.some((r) => r._tag === 'Die' && r.defect === cleanup),
    ).toBe(true)
  }
})
