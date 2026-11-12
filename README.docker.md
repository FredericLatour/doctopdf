# doctopdf

An HTTP service that converts DOCX and Markdown documents into a single merged PDF.

Upload your documents with a JSON manifest to choose their order, supply optional placeholder values, and select a theme for Markdown. The image includes LibreOffice, Chromium, the `default` and `color` themes, and DejaVu, Liberation, and Carlito fonts.

## Quick start

```bash
docker run -d --name doctopdf --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  fredericlatour/doctopdf:latest
```

The service is available at `http://localhost:3000`. Check that it is running:

```bash
curl --fail http://localhost:3000/healthz
```

Expected response: `{"status":"ok"}`.

## Convert documents

With `cover.docx` and `summary.md` in your current directory:

```bash
curl --fail-with-body http://localhost:3000/render \
  -F 'manifest={
    "variables":{"title":"Quarterly Review","customerName":"Acme"},
    "theme":"default",
    "outputName":"report.pdf",
    "documents":[
      {"field":"cover","type":"docx"},
      {"field":"summary","type":"markdown"}
    ]
  }' \
  -F 'cover=@./cover.docx' \
  -F 'summary=@./summary.md' \
  -o report.pdf
```

The response is a PDF containing the DOCX document followed by the Markdown document. Each multipart field name must match its manifest entry. You can also submit a single document.

Placeholder substitution is optional. DOCX uses `{title}` and Markdown uses `{{title}}` by default; values come from `variables`. Documents without placeholders can be converted directly.

The service also accepts ZIP uploads through `POST /render-zip`. See the [full API documentation](https://github.com/FredericLatour/doctopdf#endpoints) for the ZIP manifest, request options, and examples.

## Image tags and platforms

- `latest`: the most recently published stable release.
- Version tags, such as `2.0.0`: a specific release, without the Git tag's `v` prefix. This is a naming example; check the available tags before pulling.
- Prerelease tags, such as `2.0.0-rc.1`: preview releases that do not update `latest`.

Images are published for **linux/amd64**. Native ARM64 images are not currently published.

Choose a version tag for controlled upgrades, or an image digest for an immutable reference. See [available tags](https://hub.docker.com/r/fredericlatour/doctopdf/tags) and [release notes](https://github.com/FredericLatour/doctopdf/releases).

## Configuration

Pass environment variables with Docker's `-e` or `--env-file` options. For example:

```bash
docker run -d --name doctopdf --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DOCX_TIMEOUT_MS=90000 \
  -e MARKDOWN_IDLE_MS=60000 \
  fredericlatour/doctopdf:latest
```

Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port inside the container; update the port mapping if changed. |
| `DOCX_TIMEOUT_MS` | `60000` | Timeout for each LibreOffice conversion. |
| `MARKDOWN_TIMEOUT_MS` | `30000` | Markdown rendering budget after acquiring the browser; `0` disables this budget. |
| `MARKDOWN_IDLE_MS` | `0` | Close Chromium after this idle period; `0` keeps it until shutdown. |
| `FORMDATA_TIMEOUT_MS` | `30000` | Multipart upload parsing budget; `0` disables it. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Drain period before interrupting remaining requests during shutdown. |

Timeouts do not include all queueing and cleanup time. Configuration is read at startup; recreate the container to apply changed environment values.

Placeholder delimiters can be configured independently with `DOCX_DELIMITER_START` / `DOCX_DELIMITER_END` and `MARKDOWN_DELIMITER_START` / `MARKDOWN_DELIMITER_END`. Set both values in a pair to nonempty strings. A document's manifest can override its delimiters.

See the [complete configuration reference](https://github.com/FredericLatour/doctopdf#configuration) and [delimiter examples](https://github.com/FredericLatour/doctopdf#custom-delimiters).

## Themes and fonts

Select the built-in `default` or `color` Markdown theme through the manifest's `theme` property. DOCX layout comes from the source document.

For custom themes or fonts, see the [theme documentation](https://github.com/FredericLatour/doctopdf#themes) and [font instructions](https://github.com/FredericLatour/doctopdf#fonts). Custom fonts can be included when building your own image from the source repository.

## Project and support

- [Source code and full documentation](https://github.com/FredericLatour/doctopdf)
- [Report an issue](https://github.com/FredericLatour/doctopdf/issues)
- [Release notes](https://github.com/FredericLatour/doctopdf/releases)
