# PRISM External Documentation Site (mkdocs scaffold)

This directory is a **scaffold** for an external, public-facing documentation site that mirrors and curates the contents of `docs/`. It uses [MkDocs](https://www.mkdocs.org/) with the [Material theme](https://squidfunk.github.io/mkdocs-material/).

The scaffold is intentionally minimal — it is **not** the canonical docs source. The internal `docs/` tree remains authoritative; the external site selectively republishes a curated subset for users.

## Build locally

Requires Python 3.10 (`.venv` is the canonical environment).

```powershell
.venv\Scripts\Activate.ps1
pip install mkdocs mkdocs-material
mkdocs build -f docs/site/mkdocs.yml
mkdocs serve -f docs/site/mkdocs.yml
```

Or via npm:

```powershell
npm run docs:build
```

The `docs:build` script invokes `mkdocs build`. If MkDocs is not installed, the script prints an actionable error and exits non-zero.

## Layout

- `mkdocs.yml` — site config (theme, nav, plugins)
- `index.md` — landing page (curated overview of PRISM)
- `nav.yml` — generated nav source (committed for reproducibility)

## Deployment

GitHub Pages is the default target:

```powershell
mkdocs gh-deploy -f docs/site/mkdocs.yml
```

Hosting decisions (Netlify, Cloudflare Pages, custom domain) are operational and live outside the source tree.
