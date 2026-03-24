import { z } from 'zod'

export const DocumentDescriptorSchema = z.object({
  field: z.string().min(1, 'Each document requires a unique field name'),
  filename: z.string().optional(),
  type: z.enum(['docx', 'markdown', 'md']).default('docx'),
})

export const RenderRequestSchema = z.object({
  variables: z.record(z.any()).default({}),
  theme: z.string().default('default'),
  outputName: z.string().optional(),
  documents: z
    .array(DocumentDescriptorSchema)
    .nonempty('At least one document must be provided for rendering'),
})

export const ZipDocumentDescriptorSchema = z.object({
  file: z.string().min(1, 'Each document requires a zip file path'),
  filename: z.string().optional(),
  type: z.enum(['docx', 'markdown', 'md']).default('docx'),
})

export const RenderZipRequestSchema = z.object({
  variables: z.record(z.any()).default({}),
  theme: z.string().default('default'),
  outputName: z.string().optional(),
  documents: z
    .array(ZipDocumentDescriptorSchema)
    .nonempty('At least one document must be provided for rendering'),
})

export type DocumentDescriptor = z.infer<typeof DocumentDescriptorSchema>
export type RenderRequest = z.infer<typeof RenderRequestSchema>
export type ZipDocumentDescriptor = z.infer<typeof ZipDocumentDescriptorSchema>
export type RenderZipRequest = z.infer<typeof RenderZipRequestSchema>
