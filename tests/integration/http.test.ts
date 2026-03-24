import { describe, expect, test } from 'bun:test';
import { basename, join, parse } from 'node:path';

import { mergePdfFiles } from '../../src/pdf';
import { createApp, type AppDependencies } from '../../src/index';
import { cleanupJob, createJobDirectories } from '../../src/temp';
import { extractZipFiles } from '../../src/zip';
import {
  cleanupDir,
  createPdfBytes,
  createZipFromFiles,
  fixtureBytes,
  fixtureText,
  makeTempDir,
  parsePdfPageCount,
  writePdf,
} from '../helpers';

function makeDependencies(): AppDependencies {
  return {
    createJobDirectories,
    cleanupJob,
    extractZipFiles,
    fillTemplate: (template) => template,
    async convertDocxToPdf(docxPath, outputDir) {
      const outputPath = join(outputDir, `${parse(docxPath).name}.pdf`);
      await writePdf(outputPath, [`DOCX:${basename(docxPath)}`]);
      return outputPath;
    },
    async renderMarkdownToPdf(markdownInput) {
      return createPdfBytes([`MD:${markdownInput.trim()}`]);
    },
    mergePdfFiles,
  };
}

describe('http service', () => {
  test('healthz returns ok', async () => {
    const app = createApp(makeDependencies());
    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('render merges docx and markdown inputs', async () => {
    const app = createApp(makeDependencies());
    const form = new FormData();
    form.set(
      'manifest',
      JSON.stringify({
        variables: { title: 'Quarterly Review', customerName: 'Acme' },
        outputName: 'Quarterly Review.pdf',
        documents: [
          { field: 'cover', type: 'docx' },
          { field: 'summary', type: 'markdown' },
        ],
      }),
    );
    form.set(
      'cover',
      new File([await fixtureBytes('simple-template.docx')], 'simple-template.docx'),
    );
    form.set(
      'summary',
      new File([await fixtureText('markdown/simple.md')], 'simple.md', { type: 'text/markdown' }),
    );

    const response = await app.request('/render', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('Quarterly_Review.pdf');

    const pageCount = await parsePdfPageCount(new Uint8Array(await response.arrayBuffer()));
    expect(pageCount).toBe(2);
  });

  test('render-zip accepts nested archive paths', async () => {
    const app = createApp(makeDependencies());
    const tempDir = await makeTempDir('doctopdf-http-');

    try {
      const zipPath = join(tempDir, 'bundle.zip');
      await createZipFromFiles(
        [
          { source: 'simple-template.docx', pathInZip: 'docs/cover.docx' },
          { source: 'markdown/simple.md', pathInZip: 'docs/summary.md' },
        ],
        zipPath,
      );

      const form = new FormData();
      form.set(
        'manifest',
        JSON.stringify({
          variables: { title: 'Quarterly Review', customerName: 'Acme' },
          documents: [
            { file: 'docs/cover.docx', type: 'docx' },
            { file: 'docs/summary.md', type: 'markdown' },
          ],
        }),
      );
      form.set(
        'archive',
        new File([await Bun.file(zipPath).arrayBuffer()], 'bundle.zip', { type: 'application/zip' }),
      );

      const response = await app.request('/render-zip', {
        method: 'POST',
        body: form,
      });

      expect(response.status).toBe(200);
      expect(await parsePdfPageCount(new Uint8Array(await response.arrayBuffer()))).toBe(2);
    } finally {
      await cleanupDir(tempDir);
    }
  });

  test('render returns 400 when a required part is missing', async () => {
    const app = createApp(makeDependencies());
    const form = new FormData();
    form.set(
      'manifest',
      JSON.stringify({
        documents: [{ field: 'cover', type: 'docx' }],
      }),
    );

    const response = await app.request('/render', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Missing DOCX file for field "cover"');
  });
});
