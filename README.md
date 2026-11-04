# doctopdf

`doctopdf` is a Bun + Hono microservice that renders multiple source documents into a single merged PDF.

It supports two input types:

- DOCX templates rendered with `docxtemplater`
- Markdown files rendered to themed HTML, then printed to PDF with Chromium

The service accepts either individual multipart file uploads or a single zip archive, converts each document to PDF, merges the PDFs in manifest order, and streams the final file back in the response.

## How it works

1. The client sends a multipart request containing a JSON manifest plus document files.
2. Each DOCX file is filled with manifest variables.
3. Each Markdown file is expanded with manifest variables, injected into a theme, and rendered to PDF.
4. LibreOffice converts DOCX outputs to PDF.
5. The generated PDFs are merged with `pdf-lib`.
6. The merged PDF is returned as `application/pdf`.

## Endpoints

### `GET /healthz`

Simple health check:

```json
{ "status": "ok" }
```

### `POST /render`

Accepts `multipart/form-data` with:

| Part | Type | Required | Description |
| --- | --- | --- | --- |
| `manifest` | JSON string or JSON file | yes | Rendering instructions. |
| document parts | file uploads | yes | One file per manifest entry. The multipart field name must match `documents[].field`. |

Manifest shape:

```json
{
  "variables": {
    "title": "Monthly report",
    "subtitle": "March 2026",
    "customerName": "Acme"
  },
  "theme": "default",
  "outputName": "report.pdf",
  "documents": [
    {
      "field": "cover",
      "type": "docx",
      "filename": "cover.docx"
    },
    {
      "field": "summary",
      "type": "markdown",
      "filename": "summary.pdf"
    }
  ]
}
```

Notes:

- `documents` must contain at least one entry.
- `type` can be `docx`, `markdown`, or `md`.
- `filename` is optional. If omitted, the uploaded filename is used.
- `outputName` defaults to `document.pdf`.
- Files are merged in the order listed in `documents`.
- `documents[].delimiters` can override the placeholder syntax for one document; see [Custom delimiters](#custom-delimiters).

Example:

```bash
curl -X POST http://localhost:3000/render \
  -F 'manifest={
    "variables":{"title":"Quarterly Review","subtitle":"Q1 2026","customerName":"Acme"},
    "theme":"default",
    "outputName":"quarterly-review.pdf",
    "documents":[
      {"field":"cover","type":"docx"},
      {"field":"summary","type":"markdown"}
    ]
  }' \
  -F 'cover=@./cover.docx' \
  -F 'summary=@./summary.md' \
  -o quarterly-review.pdf
```

### `POST /render-zip`

Accepts `multipart/form-data` with:

| Part | Type | Required | Description |
| --- | --- | --- | --- |
| `manifest` | JSON string or JSON file | yes | Rendering instructions. |
| `archive` | zip file | yes | Zip archive containing the source documents. |

Manifest shape:

```json
{
  "variables": {
    "title": "Monthly report",
    "subtitle": "March 2026"
  },
  "theme": "color",
  "outputName": "report.pdf",
  "documents": [
    {
      "file": "cover.docx",
      "type": "docx"
    },
    {
      "file": "sections/summary.md",
      "type": "markdown",
      "filename": "summary.pdf"
    }
  ]
}
```

Notes:

- `documents[].file` must match a path inside the zip archive.
- Zip paths are normalized and rejected if they are absolute or contain `..`.
- Files are extracted and rendered only if they are listed in the manifest.
- Each document can set `delimiters` in the same way as individual uploads; see [Custom delimiters](#custom-delimiters).

Example:

```bash
curl -X POST http://localhost:3000/render-zip \
  -F 'manifest={
    "variables":{"title":"Quarterly Review","subtitle":"Q1 2026"},
    "theme":"color",
    "outputName":"quarterly-review.pdf",
    "documents":[
      {"file":"cover.docx","type":"docx"},
      {"file":"summary.md","type":"markdown"}
    ]
  }' \
  -F 'archive=@./bundle.zip' \
  -o quarterly-review.pdf
```

## Templating rules

### DOCX templates

DOCX files are rendered with `docxtemplater`. By default, use placeholders such as:

```text
{title}
{customerName}
```

Values come from `manifest.variables`.

### Markdown documents

By default, Markdown files use `{{variable}}` interpolation before Markdown is rendered:

```md
# {{title}}

Prepared for {{customerName}}
```

Missing Markdown variables resolve to an empty string.

### Custom delimiters

DOCX and Markdown placeholder delimiters are configurable independently. The effective pair for each document is selected in this order, with later settings taking priority:

1. Built-in defaults: `{` / `}` for DOCX, `{{` / `}}` for Markdown.
2. Environment settings for that format, including variables loaded from `.env`.
3. The document's optional `delimiters` object in the manifest.

The `md` alias uses the same settings as `markdown`. An override applies to that document only; one request can combine different placeholder conventions.

For example, set these environment variables to use `[title]` in DOCX and `[[title]]` in Markdown:

```dotenv
DOCX_DELIMITER_START="["
DOCX_DELIMITER_END="]"
MARKDOWN_DELIMITER_START="[["
MARKDOWN_DELIMITER_END="]]"
```

Bun loads `.env` files automatically when running locally. For container deployments, supply these values through the container's environment. Environment defaults are read when the application starts, so restart the service after changing them.

Both environment variables for a format must be set together to nonempty strings. An incomplete or empty environment pair prevents startup and reports the variable names. Leave both variables unset to keep that format's built-in defaults.

To choose delimiters for individual uploads, add `delimiters` to a document entry:

```json
{
  "variables": { "title": "Quarterly Review" },
  "documents": [
    {
      "field": "cover",
      "type": "docx",
      "delimiters": { "start": "{", "end": "}" }
    },
    {
      "field": "summary",
      "type": "markdown",
      "delimiters": { "start": "<%", "end": "%>" }
    }
  ]
}
```

Here the DOCX template uses `{title}` and the Markdown file uses `<%title%>`, regardless of environment defaults. Omitting `delimiters` inherits the configured defaults for the document's format.

ZIP manifests accept the same option on entries identified by `file`, for example:

```json
{
  "file": "sections/summary.md",
  "type": "md",
  "delimiters": { "start": "<%", "end": "%>" }
}
```

A document override must supply both `start` and `end` as nonempty strings; invalid overrides return `400`. Delimiters are matched literally, including regex punctuation. Markdown expansion still occurs before parsing, including inside code spans and fenced code blocks.

HTML theme markers keep their existing syntax: `{{content}}`, `{{title}}`, other `{{...}}` placeholders, and `__STYLES__` are independent of document delimiter settings.

## Themes

Markdown documents are rendered through a theme stored under [`themes/`](/Users/frederic/devel/enesys/doctopdf/themes).

Available themes in this repository:

- `default`
- `color`

Each theme contains:

- `template.html`: HTML wrapper
- `theme.css`: CSS injected into the template

Theme template conventions:

- `{{content}}` is replaced with rendered Markdown HTML
- `__STYLES__` is replaced with the theme CSS
- other `{{...}}` placeholders are resolved from `manifest.variables`

If a referenced theme directory does not exist, rendering fails.

## Local development

### Prerequisites

To run outside Docker, the host machine needs:

- Bun 1.4.4 (also pinned in `package.json` and the Docker image)
- LibreOffice with `soffice` available on `PATH`
- Chromium or another compatible Chromium binary

The service uses:

- LibreOffice for DOCX -> PDF conversion
- Playwright Core + Chromium for Markdown -> PDF rendering
- `pdf-lib` for PDF merging

### Start the service

```bash
bun install
bun dev
```

The server listens on `http://localhost:3000` by default.

For a production-style local run:

```bash
bun start
```

## Testing

Run formatting, lint, and type checks:

```bash
bun run check
bun run typecheck
```

The repository includes three test layers:

- unit tests for schema validation, filename handling, zip path safety, and DOCX templating
- integration tests for the HTTP layer using injected fakes instead of LibreOffice and Chromium
- Docker-backed end-to-end tests for the real rendering pipeline

Run the fast suite:

```bash
bun run test:fast
```

Run the Docker e2e suite:

```bash
bun run test:e2e
```

Run everything:

```bash
bun run test:all
```

Note:

- `bun test` is Bun's built-in test discovery command and will run all matching tests in the repository, including [`tests/e2e/`](/Users/frederic/devel/enesys/doctopdf/tests/e2e)
- use `bun run test:fast` when you want only unit + integration tests

Test fixtures live under [`tests/fixtures/`](/Users/frederic/devel/enesys/doctopdf/tests/fixtures). The `.docx` fixtures are generated from source XML in [`tests/fixtures/docx-src/`](/Users/frederic/devel/enesys/doctopdf/tests/fixtures/docx-src), so they can be reviewed and regenerated deterministically:

```bash
bun run fixtures:generate
```

## Docker

The provided [`Dockerfile`](/Users/frederic/devel/enesys/doctopdf/Dockerfile) installs Bun, LibreOffice, Chromium, Poppler utilities, and baseline fonts.

Build and run:

```bash
docker build -t doctopdf .
docker run --rm -p 3000:3000 -e PORT=3000 doctopdf
```

The container sets `CHROMIUM_PATH=/usr/bin/chromium`.

## Fonts

The Docker image includes:

- DejaVu
- Liberation
- Carlito

Custom fonts can be added by placing `.ttf` or `.otf` files in [`fonts/`](/Users/frederic/devel/enesys/doctopdf/fonts) before building the image. They are copied into `/usr/local/share/fonts/custom` and cached during the image build.

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `CHROMIUM_PATH` | unset locally, `/usr/bin/chromium` in Docker | Override the Chromium executable path. |
| `DOCX_DELIMITER_START` | unset (uses `{`) | Opening DOCX delimiter; set together with `DOCX_DELIMITER_END`. |
| `DOCX_DELIMITER_END` | unset (uses `}`) | Closing DOCX delimiter; set together with `DOCX_DELIMITER_START`. |
| `MARKDOWN_DELIMITER_START` | unset (uses `{{`) | Opening Markdown delimiter; set together with `MARKDOWN_DELIMITER_END`. |
| `MARKDOWN_DELIMITER_END` | unset (uses `}}`) | Closing Markdown delimiter; set together with `MARKDOWN_DELIMITER_START`. |
| `FORMDATA_TIMEOUT_MS` | `30000` | Budget for reading and parsing the multipart body; `0` disables it. |
| `MARKDOWN_TIMEOUT_MS` | `30000` | Budget for page creation, HTML loading, and PDF generation after acquiring the browser; `0` disables it. Browser launch/connect each use this timeout, or 30 seconds when disabled. |
| `MARKDOWN_WAIT_UNTIL` | `domcontentloaded` | Playwright wait condition: `load`, `domcontentloaded`, or `networkidle`. |
| `MARKDOWN_IDLE_MS` | `0` | Close Chromium after this idle period, measured from the last completed render. `0` keeps it until shutdown. |
| `MARKDOWN_CLOSE_TIMEOUT_MS` | `5000` | Timeout for closing Chromium cleanly. |
| `MARKDOWN_DEBUG` | unset | Set to `1` to log Markdown rendering phases. |
| `MARKDOWN_MAX_CHARS` | unset | Reject Markdown input longer than this value. |
| `MERGE_TIMEOUT_MS` | `30000` | Budget for the complete merge; `0` disables it. See cancellation limitations below. |
| `DOCX_TIMEOUT_MS` | `60000` | Positive timeout for each LibreOffice conversion after acquiring its concurrency permit. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Positive drain period before shutdown interrupts remaining requests. |

The `RenderConfig` service loads and validates configuration once at startup using Effect Config. Numeric settings must be nonnegative integers (port: 0–65535); close, DOCX, and shutdown timeouts must be positive. Invalid numbers, wait conditions, or incomplete delimiter pairs stop startup with a typed configuration error. Bun continues to load `.env` files.

Documents render sequentially in manifest order. Across requests, Chromium renders and LibreOffice conversions each have one concurrency permit. The converter service owns an isolated LibreOffice profile, reused under its single permit and removed on shutdown. This prevents conversion being forwarded to an unrelated process while avoiding profile initialization on every request.

Client disconnects interrupt their request effects. Scoped cleanup closes pages, stops conversion process groups, and removes job directories. SIGINT/SIGTERM stop intake, allow the configured drain period, then interrupt outstanding jobs and dispose shared services. Chromium starts lazily and can be relaunched after failure or cancellation.

Timeouts are operation budgets, not hard wall-clock response guarantees: queued work waits for a permit, cleanup takes additional time, and local filesystem operations are awaited before deleting their paths. PDF merging and synchronous template/Markdown work cannot be preempted while JavaScript is executing; strict CPU deadlines would require worker isolation. Requests, ZIP inputs, and selected ZIP entries are still buffered in memory.

## Error behavior

Common request failures include:

- missing `manifest`
- missing required file parts
- invalid JSON manifest
- empty `documents` array
- incomplete, empty, or non-string document delimiters
- DOCX template rendering errors
- LibreOffice conversion failures
- missing files inside zip archives
- invalid zip paths
- Markdown rendering or Chromium failures

Client input, invalid archives, missing files, and DOCX template errors return `400` with a text message. Infrastructure failures (including Chromium/LibreOffice failures and missing theme assets), unexpected defects, and cleanup failures return `500` with a generic JSON message. Typed operation timeouts return `504` with a JSON message naming the stage. Interruption uses an empty `499` response if the connection is still writable; disconnected clients usually receive no response.

These classifications intentionally differ from the previous implementation: Chromium failures are no longer reported as client errors, malformed ZIPs are client errors, and operation timeouts have a dedicated status. Original error causes remain available inside the Effect failure, but logs only contain safe error categories/stages and request/document identifiers, never uploaded content or variable values.

## Application architecture

The source folders separate application setup, HTTP handling, Effect services, and document helpers:

```text
src/
├── main.ts                      # Entrypoint and shutdown signals
├── errors.ts                    # Tagged failures and deadline handling
├── app/
│   └── runtime.ts               # Effect layer composition
├── http/
│   ├── app.ts                   # Hono routes and HTTP error mapping
│   └── server.ts                # Server startup and drain/disposal
├── services/
│   ├── config.ts                # Effect configuration service and defaults
│   ├── document-renderer.ts     # Shared rendering pipeline
│   ├── docx-renderer.ts         # DOCX conversion with LibreOffice
│   ├── markdown-renderer.ts     # Markdown rendering
│   ├── browser.ts              # Scoped Chromium lifecycle
│   ├── pdf-merger.ts
│   ├── job-workspace.ts
│   ├── zip-reader.ts
│   └── cancellation.ts          # Cancellation support for async adapters
└── documents/
    ├── schemas.ts              # Zod request schemas and inferred types
    ├── docx-template.ts
    ├── theme.ts
    └── filenames.ts
```

Hono owns HTTP parsing, Zod validation, and response/error mapping in [`src/http/app.ts`](src/http/app.ts). [`src/services/document-renderer.ts`](src/services/document-renderer.ts) contains the shared `DocumentRenderer` pipeline. `DocxRenderer`, `MarkdownRenderer`, `Browser`, `ZipReader`, `PdfMerger`, and `JobWorkspace` expose typed Effect methods and are assembled with explicit layers in [`src/app/runtime.ts`](src/app/runtime.ts).

[`src/main.ts`](src/main.ts) starts the application; [`src/http/server.ts`](src/http/server.ts) initializes the runtime before listening and owns the server's drain/disposal lifecycle. One `ManagedRuntime` owns shared services, including `RenderConfig`. Its live layer defines environment validation and defaults, with an environment `ConfigProvider` that preserves empty values for validation. Delimiter pairs are resolved once per document from its override or the configured format defaults, then passed explicitly to template helpers. Job workspaces belong to request scopes, and foreign asynchronous adapters await cancellation cleanup before releasing their scope or concurrency permit.

Tests replace services with `Layer.succeed`, keeping fast HTTP tests independent of external renderers. See [`tests/app.ts`](tests/app.ts) for test-layer composition and [`tests/config.ts`](tests/config.ts) for loading the live configuration layer with an isolated provider. Run `bun run check`, `bun run typecheck`, and `bun run test:fast`; `bun run test:e2e` additionally exercises real rendering, process/browser cancellation, HTTP disconnects, and shutdown in Docker.
