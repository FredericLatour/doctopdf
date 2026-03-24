# doctopdf

Bun + Hono microservice that accepts multiple DOCX templates, fills `{variable}` placeholders, converts the filled documents to PDF via LibreOffice, merges them, and streams the combined PDF back in a single HTTP response.

## Local development

```bash
bun install
bun dev
```

The server listens on `http://localhost:3000` by default. `PORT` overrides the port.

## API

`POST /render` (multipart/form-data)

| Part | Type | Description |
| --- | --- | --- |
| `manifest` | JSON string or file | Describes the ordered documents, global variables, and optional theme name. |
| Named document parts | DOCX file | Field name must match `field` in the manifest. |

Manifest structure:

```json
{
  "variables": { "title": "My title", "subtitle": "Monthly report" },
  "theme": "default",
  "outputName": "forecast.pdf",
  "documents": [
    {
      "field": "cover",
      "type": "docx",
      "filename": "cover.docx"
    },
    {
      "field": "body",
      "type": "markdown"
    }
  ]
}
```

Example request:

```bash
curl -X POST http://localhost:3000/render \
  -F 'manifest={"variables":{"title":"Great","subtitle":"Q1 recap"},"theme":"default","outputName":"forecast.pdf","documents":[{"field":"cover","type":"docx"},{"field":"body","type":"markdown"}]}' \
  -F 'cover=@./cover.docx' \
  -F 'body=@./body.md' \
  -o result.pdf
```

The response is `application/pdf` containing the merged output.

`POST /render-zip` (multipart/form-data)

| Part | Type | Description |
| --- | --- | --- |
| `manifest` | JSON string or file | Describes the ordered documents, global variables, and optional theme name. |
| `archive` | zip file | Zip archive containing all source files (DOCX/MD). |

Manifest structure (zip):

```json
{
  "variables": { "title": "My title", "subtitle": "Monthly report" },
  "theme": "default",
  "outputName": "forecast.pdf",
  "documents": [
    {
      "file": "cover.docx",
      "type": "docx"
    },
    {
      "file": "body.md",
      "type": "markdown"
    }
  ]
}
```

`file` values must match the paths inside the zip archive.

Example request:

```bash
curl -X POST http://localhost:3000/render-zip \
  -F 'manifest={"variables":{"title":"Great","subtitle":"Q1 recap"},"theme":"default","outputName":"forecast.pdf","documents":[{"file":"cover.docx","type":"docx"},{"file":"body.md","type":"markdown"}]}' \
  -F 'archive=@./bundle.zip' \
  -o result.pdf
```

## Docker

Build and run the containerized service (LibreOffice + Bun included):

```bash
docker build -t doctopdf .
docker run -p 3000:3000 -e PORT=3000 doctopdf
```

## Themes

Markdown documents are rendered through a theme (HTML + CSS). Built-in themes live under `themes/` (`default`, `studio`). The default theme uses `{{content}}` for the rendered Markdown HTML, `__STYLES__` inside the `<style>` tag, and accepts variables like `{{title}}`, `{{subtitle}}`, `{{footerLeft}}`, and `{{footerRight}}`.

Sample Markdown file: `data/markdown-kitchen-sink.md`.

## Environment variables (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the service. |
| `CHROMIUM_PATH` | `/usr/bin/chromium` (Docker) | Override Chromium binary path. |
| `MARKDOWN_TIMEOUT_MS` | `30000` | Timeout for Markdown HTML render and PDF generation. |
| `MARKDOWN_WAIT_UNTIL` | `domcontentloaded` | `load`, `domcontentloaded`, or `networkidle` for HTML render wait condition. |
| `MARKDOWN_IDLE_MS` | unset | If set, auto-close the shared Chromium after N ms of inactivity. |
| `MARKDOWN_CLOSE_TIMEOUT_MS` | `5000` | Timeout for shutting down Chromium cleanly. |
| `MARKDOWN_DEBUG` | unset | Set to `1` to log each Markdown rendering phase. |
| `MARKDOWN_MAX_CHARS` | unset | Hard cap for Markdown input length. |
| `FORMDATA_TIMEOUT_MS` | `30000` | Timeout for multipart parsing. |
| `MERGE_TIMEOUT_MS` | `30000` | Timeout for PDF merge steps. |

## Requirements

- LibreOffice (already bundled in the Dockerfile; install locally if you run without Docker)
- Liberation, DejaVu, and Carlito font families ship in the Docker image to provide sans-serif coverage (Carlito is metrically compatible with Calibri). Drop additional `.ttf/.otf` files into the `fonts/` directory before building—or mount them into `/usr/local/share/fonts` at runtime—and LibreOffice will use them after `fc-cache -f -v`.
- Chromium is installed for Markdown → PDF rendering. You can override the binary location with `CHROMIUM_PATH`.
- `pdf-lib` handles PDF merging inside the application, so no extra merge utilities are needed.
