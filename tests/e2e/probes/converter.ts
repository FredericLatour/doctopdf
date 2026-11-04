import { strict as assert } from 'node:assert'
import { readdir, readlink, stat } from 'node:fs/promises'
import { ConfigProvider, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import { RenderConfig } from '../../../src/app/config'
import { DocxRenderer } from '../../../src/services/docx-renderer'
import { JobWorkspace } from '../../../src/services/job-workspace'

const profilesBefore = new Set(
  (await readdir('/tmp')).filter((name) =>
    name.startsWith('doctopdf-lo-profile-'),
  ),
)
const runtime = ManagedRuntime.make(
  Layer.mergeAll(DocxRenderer.layer, JobWorkspace.layer).pipe(
    Layer.provide(JobWorkspace.layer),
    Layer.provide(RenderConfig.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          preserveEmptyStrings: true,
          env: { DOCX_TIMEOUT_MS: '50' },
        }),
      ),
    ),
  ),
)
let directory = ''
try {
  const exit = await runtime.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* JobWorkspace
        const job = yield* workspace.acquire
        directory = job.base
        const renderer = yield* DocxRenderer
        return yield* renderer.render({
          bytes: Buffer.from(
            yield* Effect.promise(() =>
              Bun.file('/tmp/converter-input.docx').arrayBuffer(),
            ),
          ),
          variables: { title: 'test' },
          delimiters: { start: '{', end: '}' },
          path: `${job.docx}/document.docx`,
          outputDir: job.pdf,
        })
      }),
    ),
  )
  assert(Exit.isFailure(exit))
  if (Exit.isFailure(exit))
    assert(
      exit.cause.reasons.some(
        (r) => r._tag === 'Fail' && r.error._tag === 'RenderTimeout',
      ),
    )
  assert.equal(
    await stat(directory).then(
      () => true,
      () => false,
    ),
    false,
  )
  for (const pid of await readdir('/proc')) {
    const exe = await readlink(`/proc/${pid}/exe`).catch(() => '')
    assert(
      !exe.endsWith('/soffice.bin'),
      `surviving LibreOffice process ${pid}`,
    )
  }
} finally {
  await runtime.dispose()
}
assert.deepEqual(
  (await readdir('/tmp')).filter(
    (name) =>
      name.startsWith('doctopdf-lo-profile-') && !profilesBefore.has(name),
  ),
  [],
)
console.log('LibreOffice timeout, process and workspace cleanup verified')
