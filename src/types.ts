import { z } from 'zod'

export const DelimitersSchema = z.object({
  start: z.string().min(1, { error: 'Opening delimiter must not be empty' }),
  end: z.string().min(1, { error: 'Closing delimiter must not be empty' }),
})

const documentOptions = {
  filename: z.string().optional(),
  type: z.enum(['docx', 'markdown', 'md']).default('docx'),
  delimiters: DelimitersSchema.optional(),
}

export const DocumentDescriptorSchema = z.object({
  field: z
    .string()
    .min(1, { error: 'Each document requires a unique field name' }),
  ...documentOptions,
})

export const RenderRequestSchema = z.object({
  variables: z.record(z.string(), z.unknown()).default({}),
  theme: z.string().default('default'),
  outputName: z.string().optional(),
  documents: z
    .array(DocumentDescriptorSchema)
    .min(1, { error: 'At least one document must be provided for rendering' }),
})

export const ZipDocumentDescriptorSchema = z.object({
  file: z.string().min(1, { error: 'Each document requires a zip file path' }),
  ...documentOptions,
})

export const RenderZipRequestSchema = z.object({
  variables: z.record(z.string(), z.unknown()).default({}),
  theme: z.string().default('default'),
  outputName: z.string().optional(),
  documents: z
    .array(ZipDocumentDescriptorSchema)
    .min(1, { error: 'At least one document must be provided for rendering' }),
})

export type Delimiters = z.infer<typeof DelimitersSchema>
export type DocumentDescriptor = z.infer<typeof DocumentDescriptorSchema>
export type RenderRequest = z.infer<typeof RenderRequestSchema>
export type ZipDocumentDescriptor = z.infer<typeof ZipDocumentDescriptorSchema>
export type RenderZipRequest = z.infer<typeof RenderZipRequestSchema>
