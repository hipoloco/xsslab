# Bug Log

Document recurring or instructive issues found while building or running the lab.

### 2026-04-29 - Playwright image and package version drift
- **Issue**: The `worker` container exited immediately because Chromium was missing from the expected Playwright path.
- **Root Cause**: The dependency range allowed a newer Playwright package than the browser image bundled in the Docker base image.
- **Solution**: Pin the worker package to `playwright@1.59.1` and align the Docker image to `mcr.microsoft.com/playwright:v1.59.1-noble`.
- **Prevention**: Keep the Playwright npm dependency and container image on the exact same version.

### 2026-04-29 - Initial repository bootstrap
- **Issue**: The workspace started as a plain directory, not a Git repository.
- **Root Cause**: The lab specification was provided before the repository scaffold existed.
- **Solution**: Initialized Git, created project memory, and documented repo conventions.
- **Prevention**: Start future project iterations from this repository root and commit milestones incrementally.
