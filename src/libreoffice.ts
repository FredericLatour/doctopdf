import { access } from 'node:fs/promises';
import { join, parse } from 'node:path';

export async function convertDocxToPdf(docxPath: string, outputDir: string): Promise<string> {
  const process = Bun.spawn({
    cmd: ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', outputDir, docxPath],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const errorText = await new Response(process.stderr).text();
    throw new Error(`LibreOffice conversion failed (${exitCode}): ${errorText}`);
  }

  const pdfName = `${parse(docxPath).name}.pdf`;
  const pdfPath = join(outputDir, pdfName);
  await access(pdfPath);
  return pdfPath;
}
