import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { convertDocxToPdf } from './libreoffice';
import { mergePdfFiles } from './pdf';
import { fillTemplate } from './template';
import { cleanupJob, createJobDirectories } from './temp';
import { renderMarkdownToPdf } from './markdown';
import { ensureDocxExtension, ensurePdfExtension, sanitizeFilename } from './utils';
import { RenderRequestSchema, RenderZipRequestSchema } from './types';
import { extractZipFiles, normalizeZipPath } from './zip';

const app = new Hono();

app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.post('/render', async (c) => {
  const requestId = crypto.randomUUID();
  console.info(`[${new Date().toISOString()}] [request:${requestId}] start`);

  const formDataTimeoutMs = Number(process.env.FORMDATA_TIMEOUT_MS ?? 30000);
  const formData = await withTimeout(
    c.req.formData(),
    formDataTimeoutMs,
    `Multipart parsing timed out after ${formDataTimeoutMs}ms`,
  );
  console.info(`[${new Date().toISOString()}] [request:${requestId}] formData parsed`);
  const manifestField = formData.get('manifest');

  if (!manifestField) {
    throw new HTTPException(400, { message: 'Missing "manifest" part in multipart body' });
  }

  let manifestJson: unknown;
  try {
    manifestJson = await readManifest(manifestField);
  } catch (error) {
    throw new HTTPException(400, {
      message: 'Manifest must be valid JSON',
      cause: error,
    });
  }

  const parsed = RenderRequestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  console.info(`[${new Date().toISOString()}] [request:${requestId}] manifest validated`);

  const job = await createJobDirectories();
  const globalVariables = parsed.data.variables ?? {};
  const theme = parsed.data.theme ?? 'default';
  const pdfPaths: string[] = [];
  const markdownTimeoutMs = Number(process.env.MARKDOWN_TIMEOUT_MS ?? 30000);

  try {
    for (const [index, spec] of parsed.data.documents.entries()) {
      const startedAt = Date.now();
      console.info(
        `[${new Date().toISOString()}] [request:${requestId}] [render] start ${index + 1}/${parsed.data.documents.length} ${spec.type}:${spec.field}`,
      );
      const filePart = formData.get(spec.field);
      if (!(filePart instanceof File)) {
        throw new HTTPException(400, {
          message: `Missing DOCX file for field "${spec.field}"`,
        });
      }

      if (spec.type === 'markdown' || spec.type === 'md') {
        const markdownInput = await filePart.text();
        let pdfBytes: Uint8Array;
        try {
          pdfBytes = await renderMarkdownToPdf(
            markdownInput,
            globalVariables,
            theme,
            {
              label: `${spec.field}:${requestId}`,
              timeoutMs: markdownTimeoutMs,
            },
          );
        } catch (error) {
          throw new HTTPException(400, {
            message: `Markdown rendering failed for field "${spec.field}"`,
            cause: error,
          });
        }
        const providedName = spec.filename ?? filePart.name ?? `document-${index + 1}.pdf`;
        const sanitizedName = sanitizeFilename(ensurePdfExtension(providedName));
        const pdfPath = join(job.pdf, `${index + 1}-${sanitizedName}`);
        await writeFile(pdfPath, pdfBytes);
        pdfPaths.push(pdfPath);
        console.info(
          `[${new Date().toISOString()}] [request:${requestId}] [render] done ${spec.type}:${spec.field} in ${Date.now() - startedAt}ms`,
        );
      } else {
        const sourceBuffer = Buffer.from(await filePart.arrayBuffer());

        let renderedBuffer: Buffer;
        try {
          renderedBuffer = fillTemplate(sourceBuffer, globalVariables);
        } catch (error) {
          throw new HTTPException(400, {
            message: `Template rendering failed for field "${spec.field}"`,
            cause: error,
          });
        }

        const providedName = spec.filename ?? filePart.name ?? `document-${index + 1}.docx`;
        const sanitizedName = sanitizeFilename(ensureDocxExtension(providedName));
        const docxPath = join(job.docx, `${index + 1}-${sanitizedName}`);
        await writeFile(docxPath, renderedBuffer);

        const pdfPath = await convertDocxToPdf(docxPath, job.pdf);
        pdfPaths.push(pdfPath);
        console.info(
          `[${new Date().toISOString()}] [request:${requestId}] [render] done ${spec.type}:${spec.field} in ${Date.now() - startedAt}ms`,
        );
      }
    }

    console.info(
      `[${new Date().toISOString()}] [request:${requestId}] [merge] start (${pdfPaths.length} documents)`,
    );
    const mergeTimeoutMs = Number(process.env.MERGE_TIMEOUT_MS ?? 30000);
    const mergedPdf = await mergePdfFiles(pdfPaths, { timeoutMs: mergeTimeoutMs });
    const outputName = sanitizeFilename(
      ensurePdfExtension(parsed.data.outputName ?? 'document.pdf'),
    );
    console.info(`[${new Date().toISOString()}] [request:${requestId}] [merge] done`);

    return new Response(mergedPdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputName}"`,
      },
    });
  } finally {
    await cleanupJob(job.base);
    console.info(`[${new Date().toISOString()}] [request:${requestId}] cleanup done`);
  }
});

app.post('/render-zip', async (c) => {
  const requestId = crypto.randomUUID();
  console.info(`[${new Date().toISOString()}] [request:${requestId}] start`);

  const formDataTimeoutMs = Number(process.env.FORMDATA_TIMEOUT_MS ?? 30000);
  const formData = await withTimeout(
    c.req.formData(),
    formDataTimeoutMs,
    `Multipart parsing timed out after ${formDataTimeoutMs}ms`,
  );
  console.info(`[${new Date().toISOString()}] [request:${requestId}] formData parsed`);

  const manifestField = formData.get('manifest');
  if (!manifestField) {
    throw new HTTPException(400, { message: 'Missing "manifest" part in multipart body' });
  }

  const archiveField = formData.get('archive');
  if (!(archiveField instanceof File)) {
    throw new HTTPException(400, { message: 'Missing "archive" zip file' });
  }

  let manifestJson: unknown;
  try {
    manifestJson = await readManifest(manifestField);
  } catch (error) {
    throw new HTTPException(400, {
      message: 'Manifest must be valid JSON',
      cause: error,
    });
  }

  const parsed = RenderZipRequestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  console.info(`[${new Date().toISOString()}] [request:${requestId}] manifest validated`);

  const job = await createJobDirectories();
  const globalVariables = parsed.data.variables ?? {};
  const theme = parsed.data.theme ?? 'default';
  const pdfPaths: string[] = [];
  const markdownTimeoutMs = Number(process.env.MARKDOWN_TIMEOUT_MS ?? 30000);

  try {
    const archiveBuffer = Buffer.from(await archiveField.arrayBuffer());
    const wantedFiles = parsed.data.documents.map((doc) => doc.file);
    const { files } = await extractZipFiles(archiveBuffer, wantedFiles);

    for (const [index, spec] of parsed.data.documents.entries()) {
      const startedAt = Date.now();
      console.info(
        `[${new Date().toISOString()}] [request:${requestId}] [render] start ${index + 1}/${parsed.data.documents.length} ${spec.type}:${spec.file}`,
      );

      const normalizedName = normalizeZipPath(spec.file);
      if (!normalizedName) {
        throw new HTTPException(400, {
          message: `Invalid file path in manifest: ${spec.file}`,
        });
      }
      const fileBuffer = files.get(normalizedName);
      if (!fileBuffer) {
        throw new HTTPException(400, {
          message: `Missing file "${spec.file}" in zip archive`,
        });
      }

      if (spec.type === 'markdown' || spec.type === 'md') {
        const markdownInput = fileBuffer.toString('utf8');
        let pdfBytes: Uint8Array;
        try {
          pdfBytes = await renderMarkdownToPdf(
            markdownInput,
            globalVariables,
            theme,
            {
              label: `${spec.file}:${requestId}`,
              timeoutMs: markdownTimeoutMs,
            },
          );
        } catch (error) {
          throw new HTTPException(400, {
            message: `Markdown rendering failed for file "${spec.file}"`,
            cause: error,
          });
        }
        const providedName = spec.filename ?? spec.file ?? `document-${index + 1}.pdf`;
        const sanitizedName = sanitizeFilename(ensurePdfExtension(providedName));
        const pdfPath = join(job.pdf, `${index + 1}-${sanitizedName}`);
        await writeFile(pdfPath, pdfBytes);
        pdfPaths.push(pdfPath);
        console.info(
          `[${new Date().toISOString()}] [request:${requestId}] [render] done ${spec.type}:${spec.file} in ${Date.now() - startedAt}ms`,
        );
      } else {
        let renderedBuffer: Buffer;
        try {
          renderedBuffer = fillTemplate(fileBuffer, globalVariables);
        } catch (error) {
          throw new HTTPException(400, {
            message: `Template rendering failed for file "${spec.file}"`,
            cause: error,
          });
        }

        const providedName = spec.filename ?? spec.file ?? `document-${index + 1}.docx`;
        const sanitizedName = sanitizeFilename(ensureDocxExtension(providedName));
        const docxPath = join(job.docx, `${index + 1}-${sanitizedName}`);
        await writeFile(docxPath, renderedBuffer);

        const pdfPath = await convertDocxToPdf(docxPath, job.pdf);
        pdfPaths.push(pdfPath);
        console.info(
          `[${new Date().toISOString()}] [request:${requestId}] [render] done ${spec.type}:${spec.file} in ${Date.now() - startedAt}ms`,
        );
      }
    }

    console.info(
      `[${new Date().toISOString()}] [request:${requestId}] [merge] start (${pdfPaths.length} documents)`,
    );
    const mergeTimeoutMs = Number(process.env.MERGE_TIMEOUT_MS ?? 30000);
    const mergedPdf = await mergePdfFiles(pdfPaths, { timeoutMs: mergeTimeoutMs });
    const outputName = sanitizeFilename(
      ensurePdfExtension(parsed.data.outputName ?? 'document.pdf'),
    );
    console.info(`[${new Date().toISOString()}] [request:${requestId}] [merge] done`);

    return new Response(mergedPdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputName}"`,
      },
    });
  } finally {
    await cleanupJob(job.base);
    console.info(`[${new Date().toISOString()}] [request:${requestId}] cleanup done`);
  }
});

app.onError((err, c) => {
  console.error(`[${new Date().toISOString()}]`, err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return c.json({ message: 'Unexpected server error' }, 500);
});

const port = Number(process.env.PORT ?? 3000);

export default {
  port,
  fetch: app.fetch,
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function readManifest(value: FormDataEntryValue): Promise<unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  if (value instanceof File) {
    return JSON.parse(await value.text());
  }

  throw new Error('Unsupported manifest field type');
}
