import { Data, Effect } from 'effect'

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
