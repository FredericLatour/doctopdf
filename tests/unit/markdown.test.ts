import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { renderMarkdownToHtml } from '../../src/markdown'
import { repoRoot } from '../helpers'

describe('Markdown templating', () => {
  test('keeps double-brace defaults and existing value expansion', async () => {
    const html = await renderMarkdownToHtml(
      '# {{ title }}\n\nMissing=[{{missing}}], Null=[{{nil}}], Zero=[{{zero}}], False=[{{no}}].\n\n{title}',
      { title: 'Quarterly Review', nil: null, zero: 0, no: false },
      'default',
    )

    expect(html).toContain('<h1>Quarterly Review</h1>')
    expect(html).toContain('Missing=[], Null=[], Zero=[0], False=[false].')
    expect(html).toContain('<p>{title}</p>')
  })

  test.each([
    { start: '{', end: '}' },
    { start: '[[', end: ']]' },
    { start: '$^(', end: ')|*' },
    { start: '\\[', end: ']\\' },
    { start: 'BEGIN', end: 'END' },
  ])('matches custom delimiters %j literally', async (delimiters) => {
    const input = `# ${delimiters.start} title ${delimiters.end}\n\nMissing=[${delimiters.start}missing${delimiters.end}]`
    const html = await renderMarkdownToHtml(
      input,
      { title: 'Custom Review' },
      'default',
      {
        delimiters,
      },
    )

    expect(html).toContain('<h1>Custom Review</h1>')
    expect(html).toContain('<p>Missing=[]</p>')
  })

  test.each([
    'default',
    'color',
  ])('document delimiters preserve %s theme placeholders, escaping, and styles', async (theme) => {
    const html = await renderMarkdownToHtml(
      '# [[title]]\n\n{{title}} / {title}',
      { title: 'Sales & Service' },
      theme,
      { delimiters: { start: '[[', end: ']]' } },
    )
    const css = await Bun.file(
      join(repoRoot, 'themes', theme, 'theme.css'),
    ).text()

    expect(html).toContain('<title>Sales &amp; Service</title>')
    expect(html).toContain('<h1>Sales &amp; Service</h1>')
    expect(html).toContain('<p>{{title}} / {title}</p>')
    expect(html).toContain(css)
    expect(html).not.toContain('__STYLES__')
    expect(html).not.toContain('{{content}}')
  })

  test('expands adjacent placeholders when delimiters contain variable-name characters', async () => {
    const html = await renderMarkdownToHtml(
      'BEGINtitleENDBEGINsubtitleEND',
      { title: 'Quarterly', subtitle: 'Review' },
      'default',
      { delimiters: { start: 'BEGIN', end: 'END' } },
    )

    expect(html).toContain('<p>QuarterlyReview</p>')
  })
})
