import MarkdownIt from 'markdown-it'
import { type Browser, chromium } from 'playwright-core'

import { applyTemplate, loadTheme } from './theme'

let sharedBrowser: Browser | null = null
let sharedLastUsedAt = 0
let sharedLaunchPromise: Promise<Browser> | null = null
let sharedIdleTimer: ReturnType<typeof setTimeout> | null = null

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})

export interface MarkdownRenderOptions {
  label?: string
  browser?: Browser
  timeoutMs?: number
  waitUntil?: WaitUntilOption
}

export async function renderMarkdownToPdf(
  markdownInput: string,
  variables: Record<string, unknown>,
  theme: string,
  options: MarkdownRenderOptions = {},
): Promise<Uint8Array> {
  const log = createLogger(options.label)
  const maxChars = Number(process.env.MARKDOWN_MAX_CHARS ?? 0)
  if (maxChars > 0 && markdownInput.length > maxChars) {
    throw new Error(
      `Markdown length ${markdownInput.length} exceeds limit ${maxChars}`,
    )
  }
  log('load theme')
  const { template, css } = await loadTheme(theme)
  log('expand markdown')
  const expandedMarkdown = normalizeMarkdown(
    interpolateMarkdown(markdownInput, variables),
  )
  log('render markdown')
  const content = markdown.render(expandedMarkdown)

  const html = applyTemplate(
    template,
    {
      ...variables,
      content,
      styles: css,
    },
    new Set(['content', 'styles']),
  )

  const timeoutMs =
    options.timeoutMs ?? Number(process.env.MARKDOWN_TIMEOUT_MS ?? 30000)
  const waitUntil =
    options.waitUntil ?? normalizeWaitUntil(process.env.MARKDOWN_WAIT_UNTIL)
  const browser = options.browser ?? (await getSharedBrowser(timeoutMs, log))

  try {
    log('new page')
    const page = await createPageWithRetry(browser, timeoutMs, log)
    try {
      await withTimeout(
        page.setContent(html, { waitUntil, timeout: timeoutMs }),
        timeoutMs,
        'Markdown HTML render timed out',
      )
      log('page rendered')
      return await withTimeout(
        page.pdf({
          format: 'A4',
          printBackground: true,
        }),
        timeoutMs,
        'Markdown PDF generation timed out',
      )
    } finally {
      await safeClosePage(page, timeoutMs, log)
    }
  } finally {
    if (!options.browser) {
      markSharedUsed()
    }
  }
}

function interpolateMarkdown(
  input: string,
  variables: Record<string, unknown>,
): string {
  return input.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, key) => {
    if (!(key in variables)) {
      return ''
    }
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}

function normalizeMarkdown(input: string): string {
  if (input.charCodeAt(0) === 0xfeff) {
    return input.slice(1)
  }
  return input
}

function createLogger(label?: string) {
  if (process.env.MARKDOWN_DEBUG !== '1') {
    return (_message: string) => undefined
  }

  return (message: string) => {
    const prefix = label ? `[markdown:${label}]` : '[markdown]'
    console.info(`${prefix} ${message}`)
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

type WaitUntilOption = 'load' | 'domcontentloaded' | 'networkidle'

function normalizeWaitUntil(value?: string): WaitUntilOption {
  if (
    value === 'load' ||
    value === 'networkidle' ||
    value === 'domcontentloaded'
  ) {
    return value
  }
  return 'domcontentloaded'
}

export async function launchMarkdownBrowser(
  timeoutMs?: number,
  log?: (message: string) => void,
): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_PATH || undefined
  const effectiveTimeout =
    timeoutMs ?? Number(process.env.MARKDOWN_TIMEOUT_MS ?? 30000)
  const logger = log ?? (() => undefined)
  logger('launch chromium')
  return withTimeout(
    chromium.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }),
    effectiveTimeout,
    'Chromium launch timed out',
  )
}

export async function closeMarkdownBrowser(
  browser: Browser,
  timeoutMs?: number,
): Promise<void> {
  const effectiveTimeout =
    timeoutMs ?? Number(process.env.MARKDOWN_CLOSE_TIMEOUT_MS ?? 5000)

  try {
    const contexts = browser.contexts()
    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        await withTimeout(
          page.close(),
          effectiveTimeout,
          'Page close timed out',
        )
      }
      await withTimeout(
        context.close(),
        effectiveTimeout,
        'Context close timed out',
      )
    }
    await withTimeout(
      browser.close(),
      effectiveTimeout,
      'Chromium close timed out',
    )
  } catch (error) {
    console.warn('[markdown] Failed to close Chromium cleanly:', error)
  }
}

export async function getSharedBrowser(
  timeoutMs?: number,
  log?: (message: string) => void,
): Promise<Browser> {
  if (sharedBrowser) {
    if (!sharedBrowser.isConnected()) {
      sharedBrowser = null
    } else {
      scheduleSharedIdle()
      return sharedBrowser
    }
  }

  if (sharedLaunchPromise) {
    return sharedLaunchPromise
  }

  sharedLaunchPromise = (async () => {
    const browser = await launchMarkdownBrowser(timeoutMs, log)
    sharedBrowser = browser
    sharedLastUsedAt = Date.now()
    scheduleSharedIdle()
    sharedLaunchPromise = null
    return browser
  })()

  return sharedLaunchPromise
}

export function markSharedUsed() {
  sharedLastUsedAt = Date.now()
  scheduleSharedIdle()
}

async function shutdownSharedBrowser() {
  if (!sharedBrowser) {
    return
  }
  const browser = sharedBrowser
  sharedBrowser = null
  await closeMarkdownBrowser(browser)
}

function scheduleSharedIdle() {
  const idleMs = Number(process.env.MARKDOWN_IDLE_MS ?? 0)
  if (!idleMs || idleMs <= 0) {
    return
  }

  if (sharedIdleTimer) {
    clearTimeout(sharedIdleTimer)
  }

  const targetTime = sharedLastUsedAt + idleMs
  const delay = Math.max(0, targetTime - Date.now())
  sharedIdleTimer = setTimeout(() => {
    void shutdownSharedBrowser()
  }, delay)
}

async function createPageWithRetry(
  browser: Browser,
  timeoutMs: number,
  log: (message: string) => void,
): Promise<import('playwright-core').Page> {
  try {
    return await withTimeout(browser.newPage(), timeoutMs, 'New page timed out')
  } catch (error) {
    if (!browser.isConnected() && !sharedLaunchPromise) {
      log('browser disconnected; relaunch')
      sharedBrowser = null
      const fresh = await getSharedBrowser(timeoutMs, log)
      return await withTimeout(fresh.newPage(), timeoutMs, 'New page timed out')
    }
    throw error
  }
}

async function safeClosePage(
  page: import('playwright-core').Page,
  timeoutMs: number,
  log: (message: string) => void,
) {
  try {
    await withTimeout(page.close(), timeoutMs, 'Page close timed out')
  } catch (error) {
    log(
      `page close failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
