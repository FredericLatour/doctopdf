import { Buffer } from 'node:buffer';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

export function fillTemplate(template: Buffer, variables: Record<string, unknown>): Buffer {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  try {
    doc.render(variables ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DOCX template rendering failed: ${message}`);
  }

  return doc.getZip().generate({ type: 'nodebuffer' });
}
