# GitHub Actions workflows (parked)

These workflow files were moved out of `.github/workflows/` because the
automated Git integration does not have the `workflow` scope required to push
changes to that directory.

To re-enable CI, move these files back to `.github/workflows/` directly on
GitHub (web UI or a local clone with full permissions):

- `ci.yml` — lint, typecheck, tests, build
- `release.yml` — release packaging
- `visual-regression.yml` — visual regression checks
