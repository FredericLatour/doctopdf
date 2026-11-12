import { expect, test } from 'bun:test'
import { ThemeNameSchema } from '../../src/documents/schemas'
import { loadTheme } from '../../src/documents/theme'

for (const theme of [
  '../default',
  '../../etc',
  '/tmp',
  '..',
  '.',
  '',
  'a/b',
  'a\\b',
]) {
  test(`rejects unsafe theme ${JSON.stringify(theme)} before reading assets`, async () => {
    await expect(loadTheme(theme)).rejects.toThrow(
      'Theme must be a directory name',
    )
  })
}
test('allows custom theme directory names', () => {
  expect(ThemeNameSchema.parse('custom-theme_2')).toBe('custom-theme_2')
})
