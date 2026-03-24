import { describe, expect, test } from 'bun:test';

import { ensureDocxExtension, ensurePdfExtension, sanitizeFilename } from '../../src/utils';

describe('utils', () => {
  test('sanitizeFilename keeps a conservative character set', () => {
    expect(sanitizeFilename('Quarterly Review 2026?.pdf')).toBe('Quarterly_Review_2026_.pdf');
  });

  test('ensureDocxExtension appends docx when missing', () => {
    expect(ensureDocxExtension('report')).toBe('report.docx');
    expect(ensureDocxExtension('report.docx')).toBe('report.docx');
  });

  test('ensurePdfExtension appends pdf when missing', () => {
    expect(ensurePdfExtension('report')).toBe('report.pdf');
    expect(ensurePdfExtension('report.pdf')).toBe('report.pdf');
  });
});
