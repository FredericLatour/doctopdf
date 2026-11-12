# Releasing

Releases use Git tags such as `v1.1.0`. Before tagging, update the version in [`package.json`](package.json) to match the tag without its `v` prefix (for example, `1.1.0`) and merge the release preparation pull request into `main`.

After committing and pushing the release's changes to `main`, create and push a tag:

```bash
git switch main
git pull --ff-only
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

The CI workflow checks formatting, lint, types, and unit/integration tests on pull requests and pushes to `main`. Pull requests also build and test the amd64 image without signing in to Docker Hub or publishing. Version tags must match `package.json`. After the fast checks pass, the workflow builds a `linux/amd64` image, runs the Docker end-to-end suite against that exact image, and pushes it to [Docker Hub](https://hub.docker.com/r/fredericlatour/doctopdf). Only then does it publish a GitHub release with [automatically generated notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes) and source archives. The GitHub release uses the built-in `GITHUB_TOKEN`. Docker publishing requires these repository Actions settings:

- Variable `DOCKERHUB_USERNAME`: `fredericlatour`.
- Secret `DOCKERHUB_TOKEN`: a Docker Hub personal access token with Read, Write & Delete permissions. Image publishing needs read/write; the Docker Hub overview sync action additionally requires delete scope.

The image repository is `fredericlatour/doctopdf`. A tag such as `v2.0.0` publishes `fredericlatour/doctopdf:2.0.0` and updates `latest`. A prerelease such as `v2.0.0-rc.1` publishes only `2.0.0-rc.1`. PRs and ordinary pushes never publish images. Releases are serialized to avoid simultaneous updates of `latest`.

After publishing a stable image and GitHub release, the workflow synchronizes [README.docker.md](README.docker.md) to the Docker Hub repository overview. Edit that file alongside user-facing image changes. Prereleases skip synchronization so the overview continues to describe `latest`. The short description remains managed on Docker Hub. Overview synchronization failures fail the workflow, but the image and GitHub release have already been published; fix the credentials or permissions and rerun the workflow. The required token scope is documented by the [sync action](https://github.com/peter-evans/dockerhub-description#action-inputs).

Publish stable releases in version order: `latest` points to the most recently published stable workflow run, not a computed maximum version. Rerunning an older stable release also updates `latest`, so avoid doing so after newer stable releases have shipped.

Use patch versions for fixes (`v0.1.1`), minor versions for new functionality (`v0.2.0`), and major versions for breaking changes once the project reaches `v1.0.0`. Tags with a suffix, such as `v0.2.0-rc.1`, are published as prereleases and do not become the latest release.

If validation fails, fix and push the code, then tag the corrected commit with a new version. Published tags should stay on the commits they originally identified. Rerunning a workflow rebuilds, tests, and republishes its image tags, but leaves an existing GitHub release unchanged. Use an image digest when an immutable deployment reference is needed.

## Testing a prepared image

The end-to-end suite normally builds its own image. To test an existing image without rebuilding it:

```bash
DOCTOPDF_E2E_IMAGE=doctopdf:local bun run test:e2e
```

The release workflow uses this mechanism before Docker Hub login or push. Initial support is `linux/amd64`; ARM images require separate rendering validation before being added.
