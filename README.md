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

DOCX files are rendered with `docxtemplater`. Use placeholders such as:

```text
{title}
{customerName}
```

Values come from `manifest.variables`.

### Markdown documents

Markdown files support `{{variable}}` interpolation before Markdown is rendered:

```md
# {{title}}

Prepared for {{customerName}}
```

Missing Markdown variables resolve to an empty string.

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

- Bun
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

The repository includes three test layers:

- unit tests for schema validation, filename handling, zip path safety, and DOCX templating
- integration tests for the HTTP layer using injected fakes instead of LibreOffice and Chromium
- Docker-backed end-to-end tests for the real rendering pipeline

Run the fast suite:

```bash
bun test
```

Run the Docker e2e suite:

```bash
bun run test:e2e
```

Run everything:

```bash
bun run test:all
```

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
| `FORMDATA_TIMEOUT_MS` | `30000` | Timeout for multipart parsing. |
| `MARKDOWN_TIMEOUT_MS` | `30000` | Timeout for Markdown HTML rendering and PDF generation. |
| `MARKDOWN_WAIT_UNTIL` | `domcontentloaded` | Playwright wait condition: `load`, `domcontentloaded`, or `networkidle`. |
| `MARKDOWN_IDLE_MS` | unset | Idle timeout before the shared Chromium instance is closed. |
| `MARKDOWN_CLOSE_TIMEOUT_MS` | `5000` | Timeout for closing Chromium cleanly. |
| `MARKDOWN_DEBUG` | unset | Set to `1` to log Markdown rendering phases. |
| `MARKDOWN_MAX_CHARS` | unset | Reject Markdown input longer than this value. |
| `MERGE_TIMEOUT_MS` | `30000` | Timeout for PDF merge work. |

## Error behavior

Common request failures include:

- missing `manifest`
- missing required file parts
- invalid JSON manifest
- empty `documents` array
- DOCX template rendering errors
- LibreOffice conversion failures
- missing files inside zip archives
- invalid zip paths
- Markdown rendering or Chromium failures

Client-side input problems generally return `400`. Unexpected internal failures return `500`.
