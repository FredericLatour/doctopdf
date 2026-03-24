import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface JobDirectories {
  base: string
  docx: string
  pdf: string
}

export async function createJobDirectories(): Promise<JobDirectories> {
  const base = await mkdtemp(join(tmpdir(), 'doctopdf-'))
  const docx = join(base, 'docx')
  const pdf = join(base, 'pdf')
  await mkdir(docx)
  await mkdir(pdf)
  return { base, docx, pdf }
}

export async function cleanupJob(base: string) {
  await rm(base, { recursive: true, force: true })
}
