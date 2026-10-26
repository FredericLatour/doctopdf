import { describe, expect, test } from 'bun:test'

import { RenderRequestSchema, RenderZipRequestSchema } from '../../src/types'

for (const { name, schema, document, reference, referenceError } of [
  {
    name: 'render',
    schema: RenderRequestSchema,
    document: { field: 'cover' },
    reference: 'field',
    referenceError: 'Each document requires a unique field name',
  },
  {
    name: 'render-zip',
    schema: RenderZipRequestSchema,
    document: { file: 'sections/cover.docx' },
    reference: 'file',
    referenceError: 'Each document requires a zip file path',
  },
]) {
  describe(`${name} schema`, () => {
    test('accepts a manifest with defaults', () => {
      const parsed = schema.parse({ documents: [document] })

      expect(parsed.theme).toBe('default')
      expect(parsed.documents).toHaveLength(1)
      expect(parsed.documents[0]).toEqual({ ...document, type: 'docx' })
      expect(parsed.variables).toEqual({})
    })

    test('preserves template variables and explicit options', () => {
      const variables = {
        title: 'Quarterly Review',
        count: 3,
        enabled: false,
        missing: null,
        customer: { name: 'Acme' },
        items: ['one', { name: 'two' }],
      }
      const manifest = {
        variables,
        theme: 'color',
        outputName: 'review.pdf',
        documents: [{ ...document, filename: 'cover.docx', type: 'docx' }],
      }

      const parsed = schema.parse(manifest)
      expect(parsed.variables).toEqual(variables)
      expect(parsed.theme).toBe('color')
      expect(parsed.outputName).toBe('review.pdf')
      expect(parsed.documents[0]).toEqual({
        ...document,
        filename: 'cover.docx',
        type: 'docx',
      })
    })

    test.each([
      'docx',
      'markdown',
      'md',
    ])('accepts the %s document type', (type) => {
      const parsed = schema.parse({ documents: [{ ...document, type }] })

      expect(parsed.documents[0]?.type).toBe(type)
    })

    test('rejects non-object variables', () => {
      for (const variables of [null, [], 'invalid', 42, true]) {
        const result = schema.safeParse({ variables, documents: [document] })

        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual(['variables'])
      }
    })

    test('rejects an empty document list with the existing message', () => {
      const result = schema.safeParse({ documents: [] })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]).toMatchObject({
        path: ['documents'],
        message: 'At least one document must be provided for rendering',
      })
    })

    test('rejects an empty document reference with the existing message', () => {
      const result = schema.safeParse({ documents: [{ [reference]: '' }] })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]).toMatchObject({
        path: ['documents', 0, reference],
        message: referenceError,
      })
    })

    test('rejects unsupported document types', () => {
      const result = schema.safeParse({
        documents: [{ ...document, type: 'pdf' }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual(['documents', 0, 'type'])
    })
  })
}
