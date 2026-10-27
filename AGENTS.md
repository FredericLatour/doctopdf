# Repository guidance

Write clear, cohesive, maintainable code. Prefer the simplest design that fully solves the current problem, and keep changes focused on the requested behavior.

## Project structure

`doctopdf` is a Bun and Hono service that renders DOCX and Markdown documents, merges PDFs in manifest order, and returns the result.

- `src/index.ts`: HTTP application, request handling, and pipeline orchestration; `createApp` accepts dependencies for integration tests.
- `src/types.ts`: Zod request schemas and their inferred TypeScript types.
- `src/template.ts` and `src/libreoffice.ts`: DOCX templating and conversion.
- `src/markdown.ts` and `src/theme.ts`: Markdown rendering, Chromium lifecycle, and HTML theme expansion.
- `src/pdf.ts`, `src/temp.ts`, `src/zip.ts`, and `src/utils.ts`: PDF merging, job directories, archive handling, and filename helpers.
- `themes/`: HTML and CSS assets. `tests/`: unit, HTTP integration, and Docker end-to-end coverage.

## Code design

- Keep functions and modules focused on one responsibility. Use names that explain the domain and purpose.
- Keep HTTP handlers focused on parsing, validation, orchestration, and responses. Put reusable rendering and file-processing behavior in domain modules that do not depend on Hono.
- Share behavior used by both upload endpoints through focused helpers. Keep format-specific behavior close to its renderer.
- Introduce abstractions when they simplify an actual use case. Avoid speculative frameworks, generic factories, and unnecessary class hierarchies.
- Prefer explicit inputs and typed options objects as configuration grows. Resolve configuration at a clear boundary and pass the effective options to the code that needs them.
- Keep helpers local until another module needs them. Give shared helpers a clear owner instead of accumulating unrelated functions in `utils.ts`.
- Reuse existing dependencies where practical. Add a dependency when its benefit justifies its maintenance cost.
- Explain non-obvious decisions and compatibility constraints in comments. Let the code express the mechanics.

## Types and validation

- Follow the existing strict TypeScript configuration and Biome conventions; use `import type` for type-only imports.
- Treat external input as `unknown`, validate it at the boundary with Zod, and infer request types from the schemas.
- Prefer narrowing and explicit types over `any`, unchecked casts, non-null assertions, and suppressed diagnostics.
- Define defaults and validation rules in one place. Keep the schemas for multipart uploads and ZIP uploads consistent when they expose the same options.

## Compatibility and configuration

- Preserve existing manifest shapes, document order, type aliases, and rendering defaults unless the task explicitly changes the contract.
- Existing DOCX templates use `{name}`; Markdown uses `{{name}}`. Preserve those defaults when adding configuration.
- When adding delimiter configuration, use **built-in defaults → environment variables, including .env → document override**. Each override supplies a complete, nonempty `start` and `end` pair, independently for each format.
- HTML theme placeholders remain `{{...}}`, with `__STYLES__` for CSS injection. Document delimiter options must remain independent of theme expansion.

## Errors and resources

- Distinguish invalid client input from internal failures. Include actionable context and preserve error causes when wrapping failures.
- Clean up job directories, streams, browser pages, timers, and processes on failure as well as success. Make resource ownership and cleanup explicit.
- Keep external operations bounded. When adding a timeout, account for cleanup of the underlying operation.
- Preserve ZIP path checks, filename sanitization, and HTML escaping. Keep deliberate raw HTML/CSS insertion explicit.
- Log useful operational context without logging uploaded document contents or template variable values.

## Verification

Use the Bun version declared in `package.json` and maintain `bun.lock` when dependencies change.

For code changes, run:

```bash
bun run check
bun run typecheck
bun run test:fast
```

- Add focused tests for new behavior and regressions. Assert observable outcomes, including relevant error paths, rather than private implementation details.
- Keep unit and HTTP integration tests independent of LibreOffice and Chromium. Use the existing dependency injection and test helpers.
- Run `bun run test:e2e` when changes affect actual rendering, PDF merging, external conversion tools, or the Docker image. It builds and runs Docker containers.
- Edit DOCX fixture source XML under `tests/fixtures/docx-src/`, then regenerate with `bun run fixtures:generate`.
- For documentation-only changes, review accuracy and the diff; runtime tests are unnecessary unless executable behavior changes.
- Report what was verified and any checks that could not be completed.

## Documentation

- Update API examples and configuration documentation alongside behavior changes.
- Keep user-facing setup and API usage in `README.md`, and maintainer release procedures in `RELEASING.md`. Use repository-relative links in repository documentation.
- For release work, keep `package.json`'s version aligned with its `v`-prefixed release tag.
- Keep this file concise and current as the repository evolves.
