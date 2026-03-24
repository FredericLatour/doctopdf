import { PDFDocument } from 'pdf-lib';

export interface MergeOptions {
  timeoutMs?: number;
}

export async function mergePdfFiles(paths: string[], options: MergeOptions = {}): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  const timeoutMs = options.timeoutMs ?? 0;

  for (const pdfPath of paths) {
    const bytes = await withTimeout(Bun.file(pdfPath).arrayBuffer(), timeoutMs, `Read timeout for ${pdfPath}`);
    const src = await withTimeout(PDFDocument.load(bytes), timeoutMs, `Load timeout for ${pdfPath}`);
    const copiedPages = await withTimeout(
      merged.copyPages(src, src.getPageIndices()),
      timeoutMs,
      `Copy pages timeout for ${pdfPath}`,
    );
    copiedPages.forEach((page) => merged.addPage(page));
  }

  return withTimeout(merged.save(), timeoutMs, 'PDF merge save timeout');
}

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
