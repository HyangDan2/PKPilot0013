# Pages workflow — one manual step

The GitHub App that maintains this repository has no `workflows` permission, so
`.github/workflows/deploy.yml` could not be pushed. The exact file lives here as
`deploy/deploy.yml`.

To finish the deployment (repository owner, once):

1. **Settings → General → Default branch** → set it to `main`
   (the repository was empty, so the first branch pushed became the default).
2. **Add file → Create new file**, path `.github/workflows/deploy.yml`,
   paste the contents of `deploy/deploy.yml`, commit to `main`.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**

The next push to `main` (or **Actions → Deploy PKPilot0013 → Run workflow**) builds,
runs the unit suite and publishes `dist/` to <https://hyangdan2.github.io/PKPilot0013/>.

After that, `deploy/` can be deleted.
