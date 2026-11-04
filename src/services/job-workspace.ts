import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Effect, Layer, type Scope } from 'effect'
import { WorkspaceError } from '../errors'

export interface JobDirectories {
  base: string
  docx: string
  pdf: string
}

export class JobWorkspace extends Context.Service<
  JobWorkspace,
  {
    acquire: Effect.Effect<JobDirectories, WorkspaceError, Scope.Scope>
    write: (
      path: string,
      bytes: Uint8Array,
    ) => Effect.Effect<void, WorkspaceError>
  }
>()('doctopdf/JobWorkspace') {
  static layer = Layer.succeed(JobWorkspace, {
    acquire: Effect.gen(function* () {
      const base = yield* Effect.acquireRelease(
        io('create job directory', () => mkdtemp(join(tmpdir(), 'doctopdf-'))),
        (base) =>
          io('remove job directory', () => cleanupJob(base)).pipe(Effect.orDie),
      )
      const job = { base, docx: join(base, 'docx'), pdf: join(base, 'pdf') }
      yield* io('create docx directory', () => mkdir(job.docx))
      yield* io('create pdf directory', () => mkdir(job.pdf))
      return job
    }),
    write: (path, bytes) => io('write document', () => writeFile(path, bytes)),
  })
}

// Filesystem operations must finish before workspace finalization can remove
// their paths. Local filesystem calls have no reliable hard cancellation API.
function io<A>(operation: string, task: () => Promise<A>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => new WorkspaceError({ operation, cause }),
  }).pipe(Effect.uninterruptible)
}

export async function cleanupJob(base: string) {
  await rm(base, { recursive: true, force: true })
}
