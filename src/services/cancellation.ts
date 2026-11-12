import { Effect } from 'effect'

/** For adapters that honor abort and settle after releasing their resources.
 * Unlike tryPromise alone, interruption waits for that settlement before the
 * caller's scope can delete files or release a concurrency permit.
 */
export function cancellable<A, E>(
  task: (signal: AbortSignal) => Promise<A>,
  error: (cause: unknown) => E,
): Effect.Effect<A, E> {
  return Effect.callback<A, E>((resume, signal) => {
    const pending = Promise.resolve().then(() => task(signal))
    pending.then(
      (value) => resume(Effect.succeed(value)),
      (cause) => resume(Effect.fail(error(cause))),
    )
    return Effect.promise(() =>
      pending.then(
        () => undefined,
        () => undefined,
      ),
    )
  })
}
