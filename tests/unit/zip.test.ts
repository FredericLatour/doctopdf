import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { extractZipFiles, normalizeZipPath } from '../../src/zip';
import { createZipFromFiles, fixtureBytes, makeTempDir, cleanupDir } from '../helpers';

describe('zip helpers', () => {
  test('normalizeZipPath rejects traversal and absolute paths', () => {
    expect(normalizeZipPath('../secret.docx')).toBeNull();
    expect(normalizeZipPath('/etc/passwd')).toBeNull();
    expect(normalizeZipPath('nested/./report.docx')).toBe('nested/report.docx');
  });

  test('extractZipFiles returns only requested files', async () => {
    const tempDir = await makeTempDir('doctopdf-test-');

    try {
      const zipPath = join(tempDir, 'bundle.zip');
      await createZipFromFiles(
        [
          { source: 'simple-template.docx' },
          { source: 'markdown/simple.md', pathInZip: 'notes/simple.md' },
        ],
        zipPath,
      );

      const archive = Buffer.from(await Bun.file(zipPath).arrayBuffer());
      const result = await extractZipFiles(archive, ['notes/simple.md']);

      expect([...result.files.keys()]).toEqual(['notes/simple.md']);
      expect(result.files.get('notes/simple.md')?.toString('utf8')).toContain('{{title}}');
    } finally {
      await cleanupDir(tempDir);
    }
  });

  test('generated docx fixture is available', async () => {
    const bytes = await fixtureBytes('simple-template.docx');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
