# eduoliveira.com

My personal academic website. It is a plain static site (HTML, CSS and JavaScript, no framework) published with GitHub Pages. Publications update themselves every month; everything else comes from a few text files I edit by hand.

## What's where

| Path | What it is | Do I edit it? |
|---|---|---|
| `content/profile.yaml` | Home page: roles, bio, links, highlights | Yes |
| `content/grants.yaml` | Grants page | Yes |
| `content/awards.yaml` | Awards page | Yes |
| `content/teaching.yaml` | Teaching page | Yes |
| `content/talks.yaml` | Projects & talks page (and its map) | Yes |
| `content/themes.yaml` | Research themes, word-cloud topics, and per-paper theme corrections | Yes |
| `venues.yaml` | Venue types and ranks (CORE, Q1, Q2, …), same format as the EF dashboard | Yes |
| `lab.yaml` | Settings for the monthly publications update (ORCID, Scholar profile) | Rarely |
| `site/` | The website itself (HTML pages, `assets/`, generated `data/`) | Only for layout or wording changes |
| `pipeline/` | The publications engine from the EF dashboard (`fetch.py`, `enrich.py`) | No |
| `scripts/` | Small scripts that turn the data and YAML into `site/data/*.json` | No |
| `data/` | Caches and the latest raw publications data | No (the monthly job updates it) |

## One-off setup on GitHub

1. Push this folder to `github.com/iameduoliveira/eportfolio` (branch `main`).
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `OPENALEX_API_KEY` (free, from openalex.org/settings/api)
   - `SERPAPI_KEY` (for Google Scholar numbers; one search a month fits SerpApi's free plan)
4. **Actions → Update and publish site → Run workflow**, to fetch publications for the first time.
   After that it runs by itself on the 1st of every month.

Until step 4 runs, the site shows the publication data included in this zip (7 November 2026).

## Everyday changes

- Edit a file in `content/` (on github.com you can click the pencil icon), commit, and the site rebuilds in a minute or two.
- YAML tips: keep the same indentation as the lines around you, and put text in quotes if it contains a colon (`:`). If a file can't be read, the Actions log says which file and line.
- To correct a paper's themes, find it in `content/themes.yaml` under `papers:` and change its `themes:` list. Your list always wins over the automatic keywords.
- To add a venue rank, edit `venues.yaml` as you did for the dashboard. It's used on the next monthly run (or press **Run workflow**).
- The navigation menu and footer are in each HTML file in `site/` (six pages plus `accessibility.html` and `404.html`).

## Preview on your computer (optional)

```bash
pip install -r requirements.txt
python scripts/prepare_research.py   # publications -> site/data/research.json
python scripts/build_content.py      # content/*.yaml -> site/data/*.json
cd site && python -m http.server 8000
# open http://localhost:8000
```

To fetch fresh publications locally: `OPENALEX_API_KEY=... SERPAPI_KEY=... python pipeline/fetch.py --out data/dashboard`

## Custom domain (launch day)

1. **Settings → Pages → Custom domain:** `www.eduoliveira.com`, then Save.
2. At your DNS provider, remove the old Google Sites records, then add:
   - `CNAME` `www` → `iameduoliveira.github.io`
   - `A` `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - (optional IPv6) `AAAA` `@` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
3. When the DNS check passes, tick **Enforce HTTPS**.
4. Remove the custom URL from Google Sites.

## How the numbers are made

- Google Scholar decides which papers exist, their years and citation counts (headline numbers on Home and Research).
- OpenAlex adds paper type, venue, rank, co-authors and institutions where it knows the paper; otherwise they come from Google Scholar.
- Papers OpenAlex already lists but Google Scholar has not picked up yet are added too (news pieces are left out), so new papers show up and count straight away. When Scholar catches up, the two records are merged automatically.
- Your name is always shown as Eduardo Oliveira, whatever spelling a database uses.
- Themes come from title keywords in `content/themes.yaml`, overridden by your per-paper corrections. The same file can add co-authors that Scholar cut off with "..." (`coauthors:`) or hide a paper (`hide: true`).
- Grants, awards, teaching and talks are exactly what is in the YAML files.
