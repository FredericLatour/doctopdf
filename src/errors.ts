import { type Cause, Config, Data, Effect } from 'effect'

export class InvalidInput extends Data.TaggedError('InvalidInput')<{
  message: string
  cause?: unknown
}> {}
export class InvalidArchive extends Data.TaggedError('InvalidArchive')<{
  message: string
  cause?: unknown
}> {}
export class MissingDocument extends Data.TaggedError('MissingDocument')<{
  message: string
}> {}
export class TemplateError extends Data.TaggedError('TemplateError')<{
  message: string
  cause: unknown
}> {}
export class ConversionError extends Data.TaggedError('ConversionError')<{
  stage: string
  cause: unknown
}> {}
export class WorkspaceError extends Data.TaggedError('WorkspaceError')<{
  operation: string
  cause: unknown
}> {}
export class RenderTimeout extends Data.TaggedError('RenderTimeout')<{
  stage: string
  timeoutMs: number
}> {}
export type RenderError =
  | InvalidInput
  | InvalidArchive
  | MissingDocument
  | TemplateError
  | ConversionError
  | WorkspaceError
  | RenderTimeout

export function deadline<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  stage: string,
  timeoutMs: number,
) {
  return timeoutMs === 0
    ? effect
    : effect.pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new RenderTimeout({ stage, timeoutMs })),
        }),
      )
}

export class ServerError extends Data.TaggedError('ServerError')<{
  operation: 'listen' | 'drain' | 'force-stop'
  cause: unknown
}> {}

/** Log categories only: arbitrary error messages/causes can contain document data. */
export function logFailure(message: string, cause: Cause.Cause<unknown>) {
  console.error(message, {
    reasons: cause.reasons.map((reason) => {
      if (reason._tag === 'Interrupt') return { category: 'Interrupt' }
      const error = reason._tag === 'Fail' ? reason.error : reason.defect
      return {
        category: reason._tag,
        ...(error instanceof Config.ConfigError
          ? { message: error.message }
          : {}),
        type: error instanceof Error ? error.name : typeof error,
        ...(typeof error === 'object' &&
        error !== null &&
        '_tag' in error &&
        typeof error._tag === 'string'
          ? { tag: error._tag }
          : {}),
        ...(error instanceof ServerError ? { operation: error.operation } : {}),
      }
    }),
  })
}
