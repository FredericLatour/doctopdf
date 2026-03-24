import { describe, expect, test } from 'bun:test';

import { RenderRequestSchema, RenderZipRequestSchema } from '../../src/types';

describe('render schemas', () => {
  test('accepts a render manifest with defaults', () => {
    const parsed = RenderRequestSchema.parse({
      documents: [{ field: 'cover' }],
    });

    expect(parsed.theme).toBe('default');
    expect(parsed.documents[0]?.type).toBe('docx');
    expect(parsed.variables).toEqual({});
  });

  test('rejects an empty render manifest', () => {
    const result = RenderRequestSchema.safeParse({ documents: [] });
    expect(result.success).toBe(false);
  });

  test('accepts zip manifests with markdown entries', () => {
    const parsed = RenderZipRequestSchema.parse({
      documents: [{ file: 'sections/summary.md', type: 'markdown' }],
    });

    expect(parsed.documents[0]?.file).toBe('sections/summary.md');
    expect(parsed.theme).toBe('default');
  });
});
