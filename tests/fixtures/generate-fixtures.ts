import { rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const fixturesDir = resolve(import.meta.dir);
const sourceDir = join(fixturesDir, 'docx-src');

const entries = await readdir(sourceDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }

  const inputDir = join(sourceDir, entry.name);
  const outputFile = join(fixturesDir, `${entry.name}.docx`);

  await rm(outputFile, { force: true });

  const process = Bun.spawn({
    cmd: ['zip', '-X', '-q', '-r', outputFile, '.'],
    cwd: inputDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`Failed to build ${entry.name}.docx: ${stderr}`);
  }
}
