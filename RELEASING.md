# Releasing

Releases use Git tags such as `v0.1.0`. The tag is the version source, so there is no separate package version to bump.

After committing and pushing the release's changes to `main`, create and push a tag:

```bash
git switch main
git pull --ff-only
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

The CI workflow checks formatting, lint, types, and unit/integration tests on pull requests and pushes to `main`. Version tags also run the Docker end-to-end suite. Once all checks pass, the workflow publishes a GitHub release with [automatically generated notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes) and source archives. It uses the built-in `GITHUB_TOKEN`; no additional secrets are needed.

Use patch versions for fixes (`v0.1.1`), minor versions for new functionality (`v0.2.0`), and major versions for breaking changes once the project reaches `v1.0.0`. Tags with a suffix, such as `v0.2.0-rc.1`, are published as prereleases and do not become the latest release.

If validation fails, fix and push the code, then tag the corrected commit with a new version. Published tags should stay on the commits they originally identified. Rerunning a successful workflow leaves an existing release unchanged.
