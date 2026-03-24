import { extname } from 'node:path';

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function ensureDocxExtension(filename: string): string {
  return extname(filename).toLowerCase() === '.docx' ? filename : `${filename}.docx`;
}

export function ensurePdfExtension(filename: string): string {
  return extname(filename).toLowerCase() === '.pdf' ? filename : `${filename}.pdf`;
}
