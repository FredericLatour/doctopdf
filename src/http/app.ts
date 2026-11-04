import { Buffer } from 'node:buffer'
import { Cause, type Config, Effect, Exit } from 'effect'
import { type Context, Hono } from 'hono'
import { RenderConfig } from '../app/config'
import type { AppRuntime } from '../app/runtime'
import {
  RenderRequestSchema,
  RenderZipRequestSchema,
} from '../documents/schemas'
import { deadline, InvalidInput, type RenderError } from '../errors'
import {
  DocumentRenderer,
  type RenderInput,
} from '../services/document-renderer'

export function createApp(runtime: AppRuntime) {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ status: 'ok' }))
  for (const kind of ['multipart', 'zip'] as const) {
    app.post(kind === 'zip' ? '/render-zip' : '/render', async (c) => {
      const requestId = crypto.randomUUID()
      const program = Effect.gen(function* () {
        const config = yield* RenderConfig
        const input = yield* parseRequest(
          c.req.raw,
          kind,
          config.formDataTimeoutMs,
        )
        const renderer = yield* DocumentRenderer
        return yield* renderer.render(input)
      }).pipe(
        Effect.annotateLogs({ requestId }),
        Effect.withSpan('http.render'),
      )
      const exit = await runtime.runPromiseExit(program, {
        signal: c.req.raw.signal,
      })
      if (Exit.isFailure(exit)) return failureResponse(c, exit.cause, requestId)
      return new Response(exit.value.bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${exit.value.filename}"`,
        },
      })
    })
  }
  app.onError((_error, c) => {
    console.error('Unhandled HTTP adapter defect')
    return c.json({ message: 'Unexpected server error' }, 500)
  })
  return app
}

function parseRequest(
  request: Request,
  kind: 'multipart' | 'zip',
  timeoutMs: number,
): Effect.Effect<RenderInput, RenderError> {
  return Effect.gen(function* () {
    // Reading through an owned reader lets interruption stop body consumption.
    // Request.formData() itself exposes no abort option once parsing has begun.
    // Bun lazily serializes FormData; capture its boundary before reading .body.
    const headers = new Headers(request.headers)
    const form = yield* deadline(
      Effect.gen(function* () {
        const bytes = yield* readBody(request)
        return yield* Effect.tryPromise({
          try: () => new Response(bytes, { headers }).formData(),
          catch: (cause) =>
            new InvalidInput({ message: 'Invalid multipart body', cause }),
        })
      }),
      'multipart',
      timeoutMs,
    )
    const manifest = form.get('manifest')
    if (!manifest)
      return yield* Effect.fail(
        new InvalidInput({
          message: 'Missing "manifest" part in multipart body',
        }),
      )
    const json: unknown = yield* Effect.tryPromise({
      try: async () =>
        JSON.parse(
          typeof manifest === 'string' ? manifest : await manifest.text(),
        ),
      catch: (cause) =>
        new InvalidInput({ message: 'Manifest must be valid JSON', cause }),
    })
    if (kind === 'zip') {
      const file = form.get('archive')
      if (!(file instanceof File))
        return yield* Effect.fail(
          new InvalidInput({ message: 'Missing "archive" zip file' }),
        )
      const parsed = RenderZipRequestSchema.safeParse(json)
      if (!parsed.success)
        return yield* Effect.fail(
          new InvalidInput({ message: parsed.error.message }),
        )
      const archive = yield* Effect.tryPromise({
        try: async () => Buffer.from(await file.arrayBuffer()),
        catch: (cause) =>
          new InvalidInput({ message: 'Unable to read archive', cause }),
      })
      return {
        ...parsed.data,
        documents: parsed.data.documents.map((spec) => ({
          ...spec,
          reference: spec.file,
        })),
        source: { kind: 'zip', archive },
      }
    }
    const parsed = RenderRequestSchema.safeParse(json)
    if (!parsed.success)
      return yield* Effect.fail(
        new InvalidInput({ message: parsed.error.message }),
      )
    const files = new Map<string, File>()
    for (const spec of parsed.data.documents) {
      const part = form.get(spec.field)
      if (part instanceof File) files.set(spec.field, part)
    }
    return {
      ...parsed.data,
      documents: parsed.data.documents.map((spec) => ({
        ...spec,
        reference: spec.field,
      })),
      source: { kind: 'multipart', files },
    }
  })
}

function readBody(request: Request) {
  return Effect.scoped(
    Effect.gen(function* () {
      const body = request.body
      if (!body) return new Uint8Array()
      const reader = yield* Effect.acquireRelease(
        Effect.sync(() => body.getReader()),
        (reader) =>
          Effect.promise(async () => {
            try {
              await reader.cancel()
            } finally {
              reader.releaseLock()
            }
          }),
      )
      const chunks: Uint8Array[] = []
      while (true) {
        const next = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: (cause) =>
            new InvalidInput({ message: 'Unable to read request body', cause }),
        })
        if (next.done) break
        chunks.push(next.value)
      }
      return Buffer.concat(chunks)
    }),
  )
}

function failureResponse(
  c: Context,
  cause: Cause.Cause<RenderError | Config.ConfigError>,
  requestId: string,
) {
  // Never print raw causes: library errors can contain uploaded document data.
  console.error('Render request failed', {
    requestId,
    reasons: cause.reasons.map((reason) => {
      if (reason._tag !== 'Fail') return { category: reason._tag }
      const error = reason.error
      return {
        category: error._tag,
        ...('stage' in error ? { stage: error.stage } : {}),
        ...('operation' in error ? { operation: error.operation } : {}),
      }
    }),
  })
  if (Cause.hasDies(cause))
    return c.json({ message: 'Unexpected server error' }, 500)
  if (Cause.hasInterruptsOnly(cause)) return new Response(null, { status: 499 })
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue
    const error = reason.error
    switch (error._tag) {
      case 'InvalidInput':
      case 'InvalidArchive':
      case 'MissingDocument':
      case 'TemplateError':
        return c.text(error.message, 400)
      case 'RenderTimeout':
        return c.json({ message: `Rendering timed out at ${error.stage}` }, 504)
      case 'ConversionError':
      case 'WorkspaceError':
        return c.json({ message: 'Unexpected server error' }, 500)
    }
  }
  return c.json({ message: 'Unexpected server error' }, 500)
}
