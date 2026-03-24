import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ThemeAssets {
  template: string;
  css: string;
}

export async function loadTheme(theme: string): Promise<ThemeAssets> {
  const themesDir = join(import.meta.dir, '..', 'themes');
  const templatePath = join(themesDir, theme, 'template.html');
  const cssPath = join(themesDir, theme, 'theme.css');

  const [template, css] = await Promise.all([
    readFile(templatePath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ]);

  return { template, css };
}

export function applyTemplate(
  template: string,
  data: Record<string, unknown>,
  rawKeys = new Set<string>(),
): string {
  let output = template;
  if (Object.hasOwn(data, 'styles') && typeof data.styles === 'string') {
    output = output.replaceAll('__STYLES__', data.styles);
  }

  return output.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (match, key) => {
    if (!(key in data)) {
      return '';
    }

    const value = data[key];
    const text = value == null ? '' : String(value);
    if (rawKeys.has(key)) {
      return text;
    }
    return escapeHtml(text);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
