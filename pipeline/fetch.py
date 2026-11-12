#!/usr/bin/env python3
"""
Build the lab dashboard dataset from OpenAlex.

    OPENALEX_API_KEY=... python scripts/fetch.py            # fetch + build site/data/*.json
    OPENALEX_API_KEY=... python scripts/fetch.py --find "Jane Doe"   # look up a person's OpenAlex ID
    python scripts/fetch.py --from-raw raw.json             # rebuild from a saved raw dump (no network)

Outputs
    site/data/data.json      everything the dashboard shows
    site/data/history.json   one snapshot per month (grows over time -> precise growth curves)
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import os
import re
import sys
import unicodedata
import time
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.openalex.org"
WORK_FIELDS = ",".join([
    "id", "doi", "display_name", "publication_year", "publication_date", "type",
    "cited_by_count", "counts_by_year", "authorships", "primary_location", "keywords", "primary_topic",
])


# ------------------------------------------------------------------ OpenAlex client
class BudgetExhausted(RuntimeError):
    """OpenAlex's free daily budget (about US$1 with a free key) is used up until midnight UTC."""


class OpenAlex:
    def __init__(self, api_key: str | None):
        import requests  # imported here so --from-raw works without it
        self.s = requests.Session()
        self.key = api_key
        self.calls = 0

    def get(self, path: str, **params):
        if self.key:
            params["api_key"] = self.key
        for attempt in range(6):
            r = self.s.get(f"{API}{path}", params=params, timeout=60)
            self.calls += 1
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                reset = r.headers.get("X-RateLimit-Reset", "")
                if reset.isdigit() and int(reset) > 120:   # not a per-second limit: the daily budget is gone
                    raise BudgetExhausted(f"OpenAlex daily budget used up; it resets in about {int(reset) // 3600 + 1} h (midnight UTC)")
            if r.status_code in (429, 500, 502, 503, 504):
                ra = r.headers.get("Retry-After", "")
                wait = min(int(ra), 60) if ra.isdigit() else 2 ** attempt * (3 if r.status_code == 429 else 1)
                print(f"  OpenAlex {r.status_code}, retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            if r.status_code == 404:
                return None
            r.raise_for_status()
        raise RuntimeError(f"OpenAlex kept failing for {path}")

    def author(self, ident: str):
        return self.get(f"/authors/{ident}")

    def search_authors(self, name: str, n: int = 10):
        res = self.get("/authors", search=name, per_page=n)
        return (res or {}).get("results", [])

    def works_for(self, author_ids: list[str]):
        out, cursor = [], "*"
        flt = "author.id:" + "|".join(author_ids)
        while cursor:
            res = self.get("/works", filter=flt, per_page=200, cursor=cursor, select=WORK_FIELDS)
            if not res:
                break
            out.extend(res.get("results", []))
            cursor = res.get("meta", {}).get("next_cursor")
            if not res.get("results"):
                break
        return out


def short(oa_id: str | None) -> str | None:
    if not oa_id:
        return None
    return oa_id.rsplit("/", 1)[-1]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def norm_title(t: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def institution_names(author: dict) -> list[str]:
    names = [i.get("display_name", "") for i in (author.get("last_known_institutions") or [])]
    names += [a.get("institution", {}).get("display_name", "") for a in (author.get("affiliations") or [])]
    return [n for n in names if n]


# ------------------------------------------------------------------ fetching
def resolve_members(cfg: dict, oa: OpenAlex) -> list[dict]:
    lab_inst = (cfg.get("lab", {}).get("institution") or "").lower()
    resolved = []
    for m in cfg["members"]:
        ids = m.get("openalex") or []
        if isinstance(ids, str):
            ids = [ids]
        ids = [short(i) for i in ids]
        how = "openalex id"
        if not ids and m.get("orcid"):
            a = oa.author(f"orcid:{m['orcid']}")
            if a:
                ids, how = [short(a["id"])], "orcid"
        if not ids:
            cands = oa.search_authors(m["name"])
            match = [c for c in cands if lab_inst and any(lab_inst in n.lower() for n in institution_names(c))]
            if match:
                best = max(match, key=lambda c: c.get("works_count", 0))
                ids, how = [short(best["id"])], "name + institution (please verify)"
        if not ids:
            print(f"  ! Could not identify {m['name']} - add an openalex: or orcid: entry", file=sys.stderr)
        else:
            print(f"  {m['name']}: {', '.join(ids)}  [{how}]")
        resolved.append({**m, "openalex": ids, "matched_by": how if ids else None})
    return resolved


def fetch_raw(cfg: dict, api_key: str | None) -> dict:
    oa = OpenAlex(api_key)
    print("Resolving members...")
    members = resolve_members(cfg, oa)
    print("Fetching works...")
    works: dict[str, dict] = {}
    authors: dict[str, dict] = {}
    for m in members:
        if not m["openalex"]:
            continue
        for aid in m["openalex"]:
            a = oa.author(aid)
            if a:
                authors[aid] = {k: a.get(k) for k in ("id", "display_name", "orcid", "works_count",
                                                       "cited_by_count", "summary_stats", "counts_by_year",
                                                       "last_known_institutions")}
        ws = oa.works_for(m["openalex"])
        for w in ws:
            works[short(w["id"])] = w
        print(f"  {m['name']}: {len(ws)} works")
    print(f"Done: {len(works)} unique works, {oa.calls} API calls")
    return {"fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "members": members, "authors": authors, "works": list(works.values())}


def recover_missing_papers(oa: OpenAlex, raw: dict, scholar: dict, cache: dict, max_age_days: int,
                           max_lookups: int = 60) -> int:
    """Papers on someone's Google Scholar profile that OpenAlex didn't list under their record(s)
    (usually because OpenAlex split the person into several records). Look each one up by title and,
    if the OpenAlex copy has an author with the member's name, add it and remember that author ID."""
    have = {short(w["id"]): w for w in raw["works"]}
    lookups = found = 0
    seen = cache.setdefault("recovered", {})
    today = dt.date.today()
    for m in raw["members"]:
        prof = scholar.get(scholar_id(m.get("scholar")) or "")
        sig = name_sig(m["name"])
        if not prof or not sig:
            continue
        my_ids = set(m.get("openalex") or [])
        mine = [w for w in have.values()
                if any(short((a.get("author") or {}).get("id")) in my_ids for a in w.get("authorships") or [])]
        mine_titles = {norm_title(w.get("display_name")) for w in mine}
        for a in prof.get("articles") or []:
            t = a.get("title") or ""
            nt = norm_title(t)
            if len(nt) < 20 or nt in mine_titles:
                continue
            if scholar_matches([{"id": "x", "title": w.get("display_name")} for w in mine], [t]):
                continue
            key = f"{m['name']}|{nt}"
            hit_cached = seen.get(key)
            if hit_cached and (today - dt.date.fromisoformat(hit_cached["checked"])).days < max_age_days:
                results = [hit_cached["work"]] if hit_cached.get("work") else []
            else:
                if lookups >= max_lookups:
                    continue
                lookups += 1
                try:
                    res = oa.get("/works", search=re.sub(r"[^\w\s]", " ", t)[:250], per_page=5, select=WORK_FIELDS) or {}
                except BudgetExhausted:
                    print("  OpenAlex budget reached - the remaining titles will be checked next run")
                    break
                results = res.get("results", [])
                seen[key] = {"checked": today.isoformat(), "work": None}
            for w in results:
                if not scholar_matches([{"id": "x", "title": w.get("display_name")}], [t]):
                    continue
                hit = [short((au.get("author") or {}).get("id")) for au in w.get("authorships") or []
                       if name_sig((au.get("author") or {}).get("display_name") or au.get("raw_author_name")) == sig]
                if hit and hit[0]:
                    seen[key]["work"] = w
                    have.setdefault(short(w["id"]), w)
                    if hit[0] not in my_ids:
                        my_ids.add(hit[0])
                        m.setdefault("openalex", []).append(hit[0])
                    mine.append(w); mine_titles.add(nt)
                    found += 1
                    break
    raw["works"] = list(have.values())
    print(f"Recovered {found} paper(s) from Google Scholar titles ({lookups} new OpenAlex searches)")
    return found


def fetch_citing_countries(oa: OpenAlex, work_ids: list[str]) -> dict:
    """Where the lab is cited from: countries of the authors of every paper citing lab papers,
    per year of the citing paper. Uses OpenAlex group_by, so ~1 call per 100 lab papers per year."""
    by_year: dict[str, Counter] = defaultdict(Counter)
    papers_by_year: Counter = Counter()
    ids = sorted(set(work_ids))
    first_detail = dt.date.today().year - 14
    for i in range(0, len(ids), 100):
        flt = "cites:" + "|".join(ids[i:i + 100])
        res = oa.get("/works", filter=flt, group_by="publication_year") or {}
        years = []
        for g in res.get("group_by", []):
            y = str(g.get("key"))
            if y.isdigit():
                papers_by_year[y if int(y) >= first_detail else str(first_detail - 1)] += g.get("count", 0)
                years.append(int(y))
        buckets = sorted({y for y in years if y >= first_detail})
        if any(y < first_detail for y in years):
            buckets.insert(0, None)          # everything before the detailed years, in one request
        for y in buckets:
            yf = f"publication_year:<{first_detail}" if y is None else f"publication_year:{y}"
            key = str(first_detail - 1) if y is None else str(y)
            r = oa.get("/works", filter=f"{flt},{yf}", group_by="authorships.countries") or {}
            for c in r.get("group_by", []):
                cc = short(str(c.get("key") or ""))
                if cc and len(cc) == 2 and cc.isalpha():
                    by_year[key][cc.upper()] += c.get("count", 0)
    print(f"Citing countries: {len({c for v in by_year.values() for c in v})} countries, "
          f"~{sum(papers_by_year.values())} citing papers")
    return {"by_year": {y: dict(c) for y, c in sorted(by_year.items())}, "papers_by_year": dict(sorted(papers_by_year.items()))}


# ------------------------------------------------------------------ Google Scholar (via SerpApi)
def scholar_id(url: str | None) -> str | None:
    m = re.search(r"[?&]user=([\w-]+)", url or "")
    return m.group(1) if m else None


def fetch_scholar(members: list[dict], key: str | None, cache_path: Path, max_age_days: int) -> dict:
    """Each member's Google Scholar profile (headline numbers, citations per year, every article
    with its citation count). Cached so re-runs within `max_age_days` cost no SerpApi searches."""
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    now = dt.datetime.now(dt.timezone.utc)
    out, calls = {}, 0
    for m in members:
        sid = scholar_id(m.get("scholar"))
        if not sid:
            continue
        cached = cache.get(sid)
        if cached and (now - dt.datetime.fromisoformat(cached["fetched_at"])).days < max_age_days:
            out[sid] = cached
            continue
        if not key:
            if cached:
                out[sid] = cached
            continue
        import requests
        prof, arts, start = None, [], 0
        try:
            while True:
                r = requests.get("https://serpapi.com/search.json", timeout=90, params={
                    "engine": "google_scholar_author", "author_id": sid, "api_key": key,
                    "hl": "en", "num": 100, "start": start})
                calls += 1
                r.raise_for_status()
                j = r.json()
                if j.get("error"):
                    raise RuntimeError(j["error"])
                if prof is None:
                    prof = {"name": (j.get("author") or {}).get("name"), "cited_by": j.get("cited_by") or {}}
                page = j.get("articles") or []
                for a in page:
                    y = str(a.get("year") or "")
                    arts.append({"title": a.get("title"), "link": a.get("link"), "authors": a.get("authors"),
                                 "publication": a.get("publication"), "year": int(y) if y.isdigit() else None,
                                 "cites": (a.get("cited_by") or {}).get("value") or 0})
                if len(page) < 100 or start >= 900 or not (j.get("serpapi_pagination") or {}).get("next"):
                    break
                start += 100
        except Exception as e:  # keep last month's numbers rather than failing the whole run
            print(f"  ! Google Scholar fetch failed for {m['name']}: {e}", file=sys.stderr)
            if cached:
                out[sid] = cached
            continue
        out[sid] = {"fetched_at": now.isoformat(timespec="seconds"), **prof, "articles": arts}
        print(f"  {m['name']}: {len(arts)} Google Scholar articles")
    cache.update(out)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
    print(f"Google Scholar: {len(out)} profile(s), {calls} SerpApi search(es) used")
    return out


def scholar_metric(prof: dict, name: str):
    for row in (prof.get("cited_by") or {}).get("table") or []:
        if name in row:
            return row[name].get("all")
    return None


# ------------------------------------------------------------------ metrics
def h_index(cites: list[int]) -> int:
    c = sorted(cites, reverse=True)
    return sum(1 for i, x in enumerate(c, 1) if x >= i)


def h_watch(papers: list[dict], this_year: int) -> dict:
    """What it takes to reach h+1: which papers, and how many more citations each."""
    cites = [p["cited_by_count"] for p in papers]
    h = h_index(cites)
    target = h + 1
    have = sum(1 for c in cites if c >= target)
    below = sorted([p for p in papers if p["cited_by_count"] < target],
                   key=lambda p: -p["cited_by_count"])
    picks = []
    for p in below[: max(target - have, 0)]:
        need = target - p["cited_by_count"]
        rate = annual_rate(p, this_year)
        picks.append({"id": p["id"], "need": need, "title": p["title"], "year": p.get("year"),
                      "c": p["cited_by_count"], "link": p.get("link") or p.get("doi"),
                      "rate": round(rate, 1),
                      "eta_months": round(12 * need / rate) if rate > 0 else None})
    return {"h": h, "target": target, "papers_needed": max(target - have, 0),
            "citations_needed": sum(p["need"] for p in picks), "papers": picks}


def annual_rate(p: dict, this_year: int) -> float:
    """Citations per year recently: last full year, blended with this year's pace."""
    cby = p.get("cby", {})
    last = cby.get(str(this_year - 1), 0)
    now = cby.get(str(this_year), 0)
    frac = max(dt.date.today().timetuple().tm_yday / 365, 0.15)
    return max(last, now / frac) if (last or now) else 0.0


def i10_watch(papers: list[dict]) -> list[dict]:
    near = [p for p in papers if 7 <= p["cited_by_count"] < 10]
    return [{"id": p["id"], "need": 10 - p["cited_by_count"], "title": p["title"], "year": p.get("year"),
             "c": p["cited_by_count"], "link": p.get("link") or p.get("doi")}
            for p in sorted(near, key=lambda p: -p["cited_by_count"])]


def per_year(papers: list[dict], key: str = "cby") -> dict[str, int]:
    tot: Counter = Counter()
    for p in papers:
        for y, n in p.get(key, {}).items():
            tot[y] += n
    return dict(sorted(tot.items()))


def cumulative(total: int, by_year: dict[str, int], years: list[int]) -> dict[str, int]:
    """Total citations at the end of each year = today's total minus everything received later."""
    out = {}
    for y in years:
        later = sum(n for yy, n in by_year.items() if int(yy) > y)
        out[str(y)] = max(total - later, 0)
    return out


# ------------------------------------------------------------------ build
def scholar_matches(works: list[dict], gs_titles: list[str]) -> set[str]:
    """IDs of OpenAlex works that also appear on the member's Google Scholar profile (by title)."""
    gs = [norm_title(t) for t in gs_titles if t]
    gss = set(gs)
    hit = set()
    for w in works:
        t = norm_title(w["title"])
        if not t:
            continue
        if t in gss or any(len(g) >= 30 and (t.startswith(g) or g.startswith(t)) for g in gs):
            hit.add(w["id"])
            continue
        for g in gs:
            sm = difflib.SequenceMatcher(None, t, g)
            if sm.real_quick_ratio() >= 0.9 and sm.quick_ratio() >= 0.9 and sm.ratio() >= 0.9:
                hit.add(w["id"])
                break
    return hit


def paper_key(s: str | None) -> str:
    """A DOI in any spelling -> '10.x/y' (lower case); anything else -> a title key."""
    s = (s or "").strip().lower()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s)
    return s if s.startswith("10.") else "t:" + norm_title(s)


def name_sig(name: str | None) -> tuple:
    """('eduardo', 'oliveira') for 'Eduardo Oliveira' / 'EDUARDO OLIVEIRA' / accented variants."""
    t = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    toks = re.findall(r"[a-z]+", t)
    return (toks[0], toks[-1]) if len(toks) >= 2 else ()


def link_split_profiles(works: dict, members: list[dict], id2slug: dict) -> dict:
    """OpenAlex sometimes splits one person into several author records. On a paper that already
    includes a lab member, a co-author whose name matches another member is taken to be that member."""
    by_sig = {name_sig(m["name"]): m["slug"] for m in members if name_sig(m["name"])}
    found: dict[str, set] = defaultdict(set)
    for w in works.values():
        known = {id2slug[a["id"]] for a in w["authors"] if a["id"] in id2slug}
        if not known:
            continue
        for a in w["authors"]:
            if not a["id"] or a["id"] in id2slug:
                continue
            slug = by_sig.get(name_sig(a["name"]))
            if slug and slug not in known:
                found[slug].add(a["id"])
    for slug, ids in found.items():
        for i in ids:
            id2slug[i] = slug
    return {k: sorted(v) for k, v in found.items()}


def filter_by_scholar(works: dict, members: list[dict], scholar: dict, id2slug: dict) -> dict:
    """Drop papers OpenAlex wrongly gives a member (it sometimes merges namesakes into one record).
    A paper stays with a member when ANY of these holds:
      - it is on their Google Scholar profile,
      - it is on a team colleague's Scholar profile (some profiles aren't kept up to date),
      - another team member co-authored it,
      - it shares a co-author with papers already confirmed for them.
    Namesakes' papers fail all four."""
    profs = {m["slug"]: scholar.get(scholar_id(m.get("scholar")) or "") for m in members}
    team_titles = [a.get("title") for p in profs.values() if p for a in p.get("articles") or []]
    dropped: dict[str, int] = {}
    for m in members:
        prof = profs[m["slug"]]
        if not prof or not prof.get("articles"):
            continue
        slug = m["slug"]
        my_ids = {i for i, s in id2slug.items() if s == slug}
        mine = [w for w in works.values() if slug in w["lab"]]
        confirmed = scholar_matches(mine, [a.get("title") for a in prof["articles"]])
        rest = [w for w in mine if w["id"] not in confirmed]
        confirmed |= scholar_matches(rest, team_titles)
        circle = {a["id"] for w in mine if w["id"] in confirmed for a in w["authors"]} - my_ids
        keep = set(confirmed)
        for w in mine:
            if w["id"] in keep:
                continue
            others = {a["id"] for a in w["authors"] if a["id"]} - my_ids
            if any(s != slug for s in w["lab"]) or others & circle:
                keep.add(w["id"])
        dropped[slug] = len(mine) - len(keep)
        for w in mine:
            if w["id"] not in keep:
                w["lab"] = [s for s in w["lab"] if s != slug]
        if dropped[slug]:
            print(f"  {m['name']}: {dropped[slug]} OpenAlex paper(s) look like a namesake's and were left out")
    return dropped


def same_paper(a: str, ya, b: str, yb) -> bool:
    """a, b: normalised titles. Same paper if identical; or one is the other plus a subtitle; or nearly
    identical (a typo, one changed word) - the last two only when the years are within 2."""
    if a == b:
        return True
    if not a or not b or abs((ya or yb or 0) - (yb or ya or 0)) > 2:
        return False
    s_, l_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(s_) >= 18 and l_.startswith(s_):
        return True
    if abs(len(a) - len(b)) <= 0.1 * len(l_) and len(s_) >= 18:
        sm = difflib.SequenceMatcher(None, a, b)
        return sm.real_quick_ratio() >= 0.92 and sm.quick_ratio() >= 0.92 and sm.ratio() >= 0.92
    return False


def clean_title(t: str | None) -> str:
    return norm_title(re.sub(r"<[^>]+>", " ", re.sub(r"\$[^$]*\$", " ", t or "")))


def title_finder(items: list[dict], title=lambda x: x["title"], year=lambda x: x.get("year")):
    """find(title, year) -> the item with the same paper title (exact, subtitle or near-identical), or None."""
    keyed = [(clean_title(title(x)), year(x), x) for x in items]
    exact = {k: x for k, _, x in keyed if k}
    def find(t, y):
        k = clean_title(t)
        if k in exact:
            return exact[k]
        return next((x for kk, yy, x in keyed if same_paper(k, y, kk, yy)), None)
    return find


def true_year(w: dict) -> int | None:
    """A paper with a fair share of its citations two or more years before its listed year is an older paper with a later date
    (often a repository copy uploaded years afterwards): its first citation year is closer to the truth."""
    cby, y0 = w.get("cby") or {}, w.get("year")
    if not y0 or not cby:
        return y0
    early = {int(y): n for y, n in cby.items() if int(y) < y0 - 1}
    # a stray early citation is just noise in the data; a real share of them is not
    if sum(early.values()) >= 2 and sum(early.values()) >= 0.2 * sum(cby.values()):
        return min(early)
    return y0


def age_profile(works: list[dict], this_year: int) -> dict[int, float]:
    """Share of a paper's citations received in each year after publication (0 = the year it came out),
    from every OpenAlex paper with yearly counts. Used to spread citations of papers OpenAlex doesn't have."""
    tot: Counter = Counter()
    for w in works:
        if w.get("year") and w["year"] >= this_year - 12:
            for y, n in w.get("cby", {}).items():
                if int(y) >= w["year"]:
                    tot[int(y) - w["year"]] += n
    return {k: v for k, v in tot.items()}


def spread(cites: int, year: int | None, profile: dict[int, float], this_year: int) -> dict[str, float]:
    if not cites or not year or year > this_year or not profile:
        return {}
    ages = range(0, this_year - year + 1)
    wts = {k: profile.get(k, 0) for k in ages}
    wts[this_year - year] *= max(dt.date.today().timetuple().tm_yday / 365, 0.15)  # this year isn't over
    z = sum(wts.values())
    return {str(year + k): cites * v / z for k, v in wts.items() if v} if z else {}


def apply_scholar(om: dict, prof: dict, oa_works: list[dict], this_year: int, since: int | None = None,
                  profile: dict | None = None) -> None:
    """Replace a member's headline numbers with their Google Scholar profile's.
    With `since`, the profile has been cut down to papers from that year on: totals, h-index and
    citations per year are then worked out from those papers (Scholar only gives them for all papers)."""
    arts = [a for a in prof["articles"] if a.get("title")]
    find = title_finder(oa_works)
    papers = []
    for i, a in enumerate(arts):
        oa = find(a["title"], a.get("year"))
        cby = {}
        if oa and oa["cby"] and oa["cited_by_count"]:  # borrow OpenAlex's yearly pattern (scaled) for citation pace
            # (since view: recent papers, whose yearly counts are complete, so scale to add up exactly)
            f = a["cites"] / (sum(oa["cby"].values()) if since else oa["cited_by_count"])
            cby = {y: n * f for y, n in oa["cby"].items()}
        elif since and profile:   # 'since' view: no yearly pattern - spread like a typical team paper
            cby = spread(a["cites"], a.get("year"), profile, this_year)
        papers.append({"id": f"S{i}", "title": a["title"], "year": a["year"], "cited_by_count": a["cites"],
                       "venue": a.get("publication"), "link": a.get("link"), "authors": a.get("authors"),
                       "cby": cby})
    cites = [p["cited_by_count"] for p in papers]
    graph = {str(g["year"]): g["citations"] for g in (prof.get("cited_by") or {}).get("graph") or []
             if g.get("year")}
    if not graph:   # 'since' view: citations per year to these papers (OpenAlex's pattern, scaled to Scholar's counts)
        graph = {y: round(n) for y, n in per_year(papers).items() if round(n) and int(y) >= (since or 0)}
    total = scholar_metric(prof, "citations") or sum(cites)
    last, prev = graph.get(str(this_year - 1), 0), graph.get(str(this_year - 2), 0)
    years = sorted({int(y) for y in graph} | {this_year})
    years = list(range(max(min(years), this_year - 14, since or 0), this_year + 1))
    om.update({
        "source": "Google Scholar", "scholar_name": prof.get("name"), "scholar_fetched": prof.get("fetched_at"),
        "works": len(papers), "citations": total,
        "h": scholar_metric(prof, "h_index") or h_index(cites),
        "i10": scholar_metric(prof, "i10_index") or sum(1 for c in cites if c >= 10),
        "cites_last_year": last, "growth": round((last - prev) / prev * 100) if prev else None,
        "cites_by_year": graph, "years": years,
        "cumulative": cumulative(total, graph, years),
        "pubs_by_year": dict(sorted(Counter(str(p["year"]) for p in papers if p["year"]).items())),
        "h_watch": h_watch(papers, this_year),
        "i10_watch": i10_watch(papers),
        "first_year": min((p["year"] for p in papers if p["year"]), default=None),
        "scholar_papers": [{"title": p["title"], "year": p["year"], "c": p["cited_by_count"],
                            "venue": p["venue"], "link": p["link"], "authors": p["authors"]}
                           for p in sorted(papers, key=lambda p: -p["cited_by_count"])],
    })



def build(cfg: dict, raw: dict, scholar: dict | None = None, since: int | None = None,
          year_fix: dict | None = None) -> dict:
    """since: only papers published in or after that year (the site's '2020 onwards' view).
    year_fix: {paper key: year} corrections from venues.yaml, so a corrected year decides the cut."""
    scholar = scholar or {}
    st = cfg.get("settings", {})
    excl_types = set(st.get("exclude_types", []))
    max_auth = int(st.get("network_max_authors", 25))
    today = dt.date.today()
    this_year = today.year

    members = []
    id2slug: dict[str, str] = {}
    for m in raw["members"]:
        slug = slugify(m["name"])
        members.append({"slug": slug, **m})
        for aid in m.get("openalex") or []:
            id2slug[aid] = slug

    # --- normalise works
    works: dict[str, dict] = {}
    for w in raw["works"]:
        if w.get("type") in excl_types:
            continue
        src = ((w.get("primary_location") or {}).get("source") or {})
        auths = []
        for a in w.get("authorships") or []:
            aid = short((a.get("author") or {}).get("id"))
            insts = [i.get("display_name") for i in a.get("institutions") or [] if i.get("display_name")]
            ccs = [i.get("country_code") for i in a.get("institutions") or [] if i.get("country_code")]
            auths.append({"id": aid, "name": (a.get("author") or {}).get("display_name") or a.get("raw_author_name"),
                          "inst": insts[0] if insts else None, "cc": ccs[0] if ccs else None})
        wid = short(w["id"])
        works[wid] = {
            "id": wid,
            "title": w.get("display_name") or "(untitled)",
            "year": w.get("publication_year"),
            "doi": w.get("doi"),
            "type": w.get("type"),
            "venue": src.get("display_name"),
            "venue_type": src.get("type") or "other",
            "cited_by_count": w.get("cited_by_count") or 0,
            "cby": {str(c["year"]): c["cited_by_count"] for c in w.get("counts_by_year") or []
                    if c.get("cited_by_count")},
            "authors": auths,
            "versions": 1,
            "kw": [k.get("display_name") for k in w.get("keywords") or [] if (k.get("score") or 0) >= 0.3 and k.get("display_name")],
            "field": (((w.get("primary_topic") or {}).get("field") or {}).get("display_name")),
        }

    # --- merge preprint/published duplicates (same normalised title)
    if st.get("merge_duplicate_titles", True):
        groups = defaultdict(list)
        for w in works.values():
            t = norm_title(w["title"])
            if len(t) >= 25:
                groups[t].append(w)
        for grp in groups.values():
            if len(grp) < 2:
                continue
            # canonical: most cited, prefer a non-repository venue on ties
            grp.sort(key=lambda w: (w["cited_by_count"], w["venue_type"] != "repository"), reverse=True)
            keep = grp[0]
            seen = {a["id"] for a in keep["authors"]}
            for other in grp[1:]:
                for a in other["authors"]:
                    if a["id"] not in seen:
                        keep["authors"].append(a)
                        seen.add(a["id"])
                if keep["venue_type"] == "repository" and other["venue_type"] != "repository":
                    keep["venue"], keep["venue_type"] = other["venue"], other["venue_type"]
                keep["versions"] += 1
                works.pop(other["id"], None)

    # --- attach lab members to each work (catching split OpenAlex profiles first)
    split = link_split_profiles(works, members, id2slug)
    for slug, ids in split.items():
        name = next(m["name"] for m in members if m["slug"] == slug)
        print(f"  {name} also appears as OpenAlex {', '.join(ids)} on joint papers - "
              f"add to their openalex: list in lab.yaml to include all of that record's papers")
    for w in works.values():
        w["lab"] = sorted({id2slug[a["id"]] for a in w["authors"] if a["id"] in id2slug})
    works = {k: w for k, w in works.items() if w["lab"]}

    # member-level exclusions
    excl = {m["slug"]: set(m.get("exclude_works") or []) for m in members}
    for w in works.values():
        w["lab"] = [s for s in w["lab"] if w["id"] not in excl[s]]
    works = {k: w for k, w in works.items() if w["lab"]}

    # When a member has a Google Scholar profile, trust it for WHICH papers are theirs: OpenAlex
    # sometimes merges namesakes into one author record, which would put strangers in the network.
    dropped: dict[str, int] = {}
    if st.get("scholar_filters_openalex", True):
        dropped = filter_by_scholar(works, members, scholar, id2slug)
        works = {k: w for k, w in works.items() if w["lab"]}

    works_all = dict(works)
    if not since:   # flag older work carrying a later date, so 'recent' lists on the site can skip it
        for w in works.values():
            ty = true_year(w)
            if ty and w["year"] and ty < w["year"]:
                w["older"] = ty
    if since:
        n_old = 0
        for w in works.values():
            fix = (year_fix or {}).get(paper_key(w.get("doi"))) or (year_fix or {}).get(paper_key(w["title"]))
            if fix:
                w["year"] = fix
            elif w["year"] and true_year(w) < w["year"]:
                n_old += (w["year"] >= since > true_year(w))
                w["year"] = true_year(w)
        works = {k: w for k, w in works.items() if (w["year"] or 0) >= since}
        if n_old:
            print(f"  {n_old} paper(s) dated {since}+ by OpenAlex were cited years earlier (a later repository copy) "
                  f"and are counted as older work")

    all_years = sorted({int(y) for w in works.values() for y in w["cby"]} |
                       {w["year"] for w in works.values() if w["year"]})
    chart_years = [y for y in all_years if y >= max(this_year - 10, since or 0)] or [this_year]

    profile, team_gs = {}, None
    if since:
        profile = age_profile(list(works.values()), this_year)
        team_arts = [a for p in scholar.values() if p for a in p.get("articles") or [] if a.get("title")]
        team_gs = title_finder(sorted(team_arts, key=lambda a: -(a.get("cites") or 0)))

    # --- per member
    out_members = []
    for m in members:
        mine = [w for w in works.values() if m["slug"] in w["lab"]]
        cites = [w["cited_by_count"] for w in mine]
        total = sum(cites)
        cby = per_year(mine)
        pubs = Counter(str(w["year"]) for w in mine if w["year"])
        venues = Counter((w["venue"], w["venue_type"]) for w in mine if w["venue"])
        vtypes = Counter(w["venue_type"] for w in mine)
        coauth_ext = Counter()
        coauth_lab = Counter()
        for w in mine:
            for a in w["authors"]:
                if a["id"] in id2slug:
                    s = id2slug[a["id"]]
                    if s != m["slug"]:
                        coauth_lab[s] += 1
                elif a["id"]:
                    coauth_ext[a["id"]] += 1
        last = cby.get(str(this_year - 1), 0)
        prev = cby.get(str(this_year - 2), 0)
        out_members.append({
            "slug": m["slug"], "name": m["name"], "role": m.get("role"),
            "active": m.get("active", True), "scholar": m.get("scholar"), "orcid": m.get("orcid"),
            "openalex": m.get("openalex") or [], "matched_by": m.get("matched_by"),
            "works": len(mine), "citations": total,
            "h": h_index(cites), "i10": sum(1 for c in cites if c >= 10),
            "cites_last_year": last, "growth": round((last - prev) / prev * 100) if prev else None,
            "cites_by_year": cby,
            "cumulative": cumulative(total, cby, chart_years),
            "pubs_by_year": dict(sorted(pubs.items())),
            "h_watch": h_watch(mine, this_year),
            "i10_watch": i10_watch(mine),
            "venues": [{"name": n, "type": t, "count": c} for (n, t), c in venues.most_common(15)],
            "venue_types": dict(vtypes),
            "collab_lab": dict(coauth_lab.most_common()),
            "collab_external": len(coauth_ext),
            "first_year": min((w["year"] for w in mine if w["year"]), default=None),
            "source": "OpenAlex", "years": chart_years,
        })
        om = out_members[-1]
        om["openalex_counts"] = {"works": om["works"], "citations": om["citations"], "h": om["h"],
                                 "dropped": dropped.get(m["slug"], 0)}
        om["openalex_extra"] = split.get(m["slug"], [])
        om["openalex"] = list(om["openalex"]) + om["openalex_extra"]
        prof = scholar.get(scholar_id(m.get("scholar")) or "")
        if prof and prof.get("articles") is not None:
            if since:
                find_all = title_finder([w for w in works_all.values() if m["slug"] in w["lab"]])
                def year_of(a):
                    oa = find_all(a["title"], a.get("year"))
                    ty = true_year({"year": a.get("year"), "cby": oa["cby"]}) if oa else a.get("year")
                    return min(a.get("year") or 0, ty or 0) if a.get("year") else None
                arts = [a for a in prof["articles"] if (year_of(a) or 0) >= since]
                fallback = not arts and bool(mine)
                if fallback:   # Scholar profile not kept up to date (nothing since that year): use OpenAlex,
                    # with a co-author's Scholar count for the paper where there is one
                    arts = [{"title": w["title"], "year": w["year"],
                             "cites": max(w["cited_by_count"], (team_gs(w["title"], w["year"]) or {}).get("cites") or 0),
                             "publication": w["venue"], "link": w.get("doi")} for w in mine]
                apply_scholar(om, {"name": prof.get("name"), "fetched_at": prof.get("fetched_at"), "articles": arts},
                              mine, this_year, since, profile)
                if fallback:
                    om["source"] = "OpenAlex"
                    om["scholar_outdated"] = True
            else:
                apply_scholar(om, prof, mine, this_year)

    # --- lab level (each paper counted once)
    lab_works = list(works.values())
    lab_cites = [w["cited_by_count"] for w in lab_works]
    lab_cby = per_year(lab_works)
    lab_total = sum(lab_cites)
    lab_source, lab_n = "OpenAlex", len(lab_works)
    lab_years = chart_years
    if out_members and all("scholar_papers" in om for om in out_members):
        best: dict[str, int] = {}
        for om in out_members:
            for p in om["scholar_papers"]:
                k = norm_title(p["title"]) or p["title"]
                best[k] = max(best.get(k, 0), p["c"])
        lab_cites = list(best.values())
        lab_total, lab_n, lab_source = sum(lab_cites), len(best), "Google Scholar"
        lab_cby = dict(sorted(sum((Counter(om["cites_by_year"]) for om in out_members), Counter()).items()))
        lab_years = sorted({int(y) for y in lab_cby} | {this_year})
        lab_years = [y for y in lab_years if y >= max(this_year - 14, since or 0)]
    venues = Counter((w["venue"], w["venue_type"]) for w in lab_works if w["venue"])

    # --- collaboration network (lab members + everyone they co-authored with)
    nodes: dict[str, dict] = {}
    edges: Counter = Counter()
    inst_counter: Counter = Counter()
    country_counter: Counter = Counter()
    ext_inst: dict[str, Counter] = defaultdict(Counter)
    for m in out_members:
        nodes[m["slug"]] = {"id": m["slug"], "label": m["name"], "lab": True, "papers": m["works"],
                            "active": m["active"], "role": m["role"], "y": m["pubs_by_year"]}
    edge_years: dict[tuple, Counter] = defaultdict(Counter)
    for w in lab_works:
        if len(w["authors"]) > max_auth:
            continue
        keys = []
        yr = str(w["year"] or this_year)  # year of the paper, for the growing-network animation
        for a in w["authors"]:
            if a["id"] in id2slug:
                keys.append(id2slug[a["id"]])
            elif a["id"]:
                keys.append(a["id"])
                n = nodes.setdefault(a["id"], {"id": a["id"], "label": a["name"], "lab": False, "papers": 0,
                                               "y": Counter()})
                n["papers"] += 1
                n["y"][yr] += 1
                if a["inst"]:
                    ext_inst[a["id"]][a["inst"]] += 1
        keys = sorted(set(keys))
        lab_keys = [k for k in keys if k in nodes and nodes[k]["lab"]]
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                if a in lab_keys or b in lab_keys:  # keep edges that touch the lab
                    edges[(a, b)] += 1
                    edge_years[(a, b)][yr] += 1
        for inst in {a["inst"] for a in w["authors"] if a["inst"] and a["id"] not in id2slug}:
            inst_counter[inst] += 1
        for cc in {a["cc"] for a in w["authors"] if a["cc"] and a["id"] not in id2slug}:
            country_counter[cc] += 1
    for nid, c in ext_inst.items():
        nodes[nid]["inst"] = c.most_common(1)[0][0]
    for n in nodes.values():
        n["y"] = dict(n["y"])

    data = {
        "generated_at": raw.get("fetched_at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "OpenAlex",
        "lab": cfg.get("lab", {}),
        "period": {"from": since} if since else {},
        "years": chart_years,
        "network_max_authors": max_auth,
        "summary": {
            "members": len(out_members), "works": lab_n, "citations": lab_total,
            "h": h_index(lab_cites), "i10": sum(1 for c in lab_cites if c >= 10),
            "cites_by_year": lab_cby, "cumulative": cumulative(lab_total, lab_cby, lab_years),
            "source": lab_source, "years": lab_years,
            "pubs_by_year": dict(sorted(Counter(str(w["year"]) for w in lab_works if w["year"]).items())),
            "venues": [{"name": n, "type": t, "count": c} for (n, t), c in venues.most_common(25)],
            "venue_types": dict(Counter(w["venue_type"] for w in lab_works)),
            "institutions": [{"name": n, "count": c} for n, c in inst_counter.most_common(20)],
            "countries": dict(country_counter.most_common(30)),
            "external_collaborators": sum(1 for n in nodes.values() if not n["lab"]),
        },
        "members": out_members,
        "works": sorted(lab_works, key=lambda w: (-w["cited_by_count"], w["title"])),
        "network": {"nodes": list(nodes.values()),
                    "edges": [{"from": a, "to": b, "w": n, "y": dict(edge_years[(a, b)])}
                              for (a, b), n in edges.items()]},
    }
    for w in data["works"]:  # trim payload
        w["authors"] = [{"id": a["id"], "name": a["name"]} for a in w["authors"]]
    return data


def enrich_data(data: dict, raw: dict, cfg: dict, venues_path: Path, data_dir: Path, oa_cache: dict,
                key: str | None, online: bool, review: bool = True) -> None:
    """Venue types and quality tiers, Scholar citations per paper, research themes (scripts/enrich.py)."""
    try:
        import enrich
    except Exception as e:   # a missing extra layer must never stop the site from building
        print(f"::warning::scripts/enrich.py could not be loaded ({e}); venues, rankings and themes are skipped this run.")
        return
    st = cfg.get("settings", {})
    raw_sources = {}
    for w in raw["works"]:
        src = ((w.get("primary_location") or {}).get("source") or {})
        if src.get("display_name"):
            raw_sources.setdefault(src["display_name"], {"id": short(src.get("id")),
                                                        "issn": src.get("issn") or ([src["issn_l"]] if src.get("issn_l") else [])})
    impact = (oa_cache.get("impact") or {}).get("v", {})
    if online and key:
        try:
            impact = enrich.fetch_impact(OpenAlex(key), [v["id"] for v in raw_sources.values()], oa_cache)
        except Exception as e:
            print(f"  ! venue impact lookup failed: {e}", file=sys.stderr)
    for step, fn in [("Scholar citations", lambda: enrich.attach_scholar(data, norm_title)),
                     ("venues", lambda: enrich.apply_venues(data, raw_sources, venues_path, data_dir, st, impact, online, review=review)),
                     ("themes", lambda: enrich.build_themes(data, st, norm_title))]:
        try:
            fn()
        except Exception as e:  # an extra layer failing must never break the site
            import traceback; traceback.print_exc()
            print(f"::warning::{step} step failed ({e}); the rest of the site is unaffected.")
    for w in data["works"]:
        w.pop("kw", None)
        w.pop("field", None)


def update_history(data: dict, path: Path) -> list:
    hist = json.loads(path.read_text()) if path.exists() else []
    month = data["generated_at"][:7]
    snap = {"date": data["generated_at"][:10],
            "lab": {k: data["summary"][k] for k in ("works", "citations", "h", "i10")},
            "members": {m["slug"]: {k: m[k] for k in ("works", "citations", "h", "i10")}
                        for m in data["members"]}}
    hist = [h for h in hist if h["date"][:7] != month] + [snap]
    hist.sort(key=lambda h: h["date"])
    path.write_text(json.dumps(hist, separators=(",", ":")))
    return hist


# ------------------------------------------------------------------ CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "lab.yaml"))
    ap.add_argument("--out", default=str(ROOT / "site" / "data"))
    ap.add_argument("--find", metavar="NAME", help="search OpenAlex for a person and print candidate IDs")
    ap.add_argument("--from-raw", metavar="FILE", help="build from a saved raw dump instead of fetching")
    ap.add_argument("--save-raw", metavar="FILE", help="also save the raw OpenAlex dump")
    ap.add_argument("--scholar-cache", default=str(ROOT / "data" / "scholar_cache.json"),
                    help="where Google Scholar profiles are cached between runs")
    args = ap.parse_args()

    key = os.environ.get("OPENALEX_API_KEY")

    if args.find:
        oa = OpenAlex(key)
        for c in oa.search_authors(args.find):
            insts = "; ".join(institution_names(c)[:2]) or "-"
            print(f"{short(c['id']):>13}  {c['display_name']:<30} works={c.get('works_count', 0):<5} "
                  f"cites={c.get('cited_by_count', 0):<6} orcid={short(c.get('orcid')) or '-':<20} {insts}")
        return

    try:
        cfg = yaml.safe_load(Path(args.config).read_text())
    except yaml.YAMLError as e:   # explain hand-editing slips (usually indentation) in plain words
        mark = getattr(e, "problem_mark", None)
        where = f"line {mark.line + 1}" if mark else "somewhere"
        print(f"::error file=lab.yaml,line={mark.line + 1 if mark else 1}::lab.yaml can't be read ({where}). "
              f"This is usually indentation: lines under the same heading need exactly the same number of spaces, "
              f"e.g. 2 for name/since/maintainer and 4 for year/reason/default.")
        print(f"Details: {e}")
        sys.exit(1)
    if args.from_raw:
        raw = json.loads(Path(args.from_raw).read_text())
    else:
        if not key:
            sys.exit("Set OPENALEX_API_KEY (free at https://openalex.org/settings/api)")
        try:
            raw = fetch_raw(cfg, key)
        except BudgetExhausted as e:
            print(f"::warning::{e}. Keeping the currently published data; the site is redeployed unchanged.")
            return
        except Exception as e:
            print(f"::warning::OpenAlex unavailable ({e}). Keeping the currently published data.")
            return
        if args.save_raw:
            Path(args.save_raw).write_text(json.dumps(raw))

    st = cfg.get("settings", {})
    scholar = raw.get("scholar")
    if scholar is None:
        print("Google Scholar profiles...")
        scholar = fetch_scholar(raw["members"], os.environ.get("SERPAPI_KEY"),
                                Path(args.scholar_cache), int(st.get("scholar_refresh_days", 20)))
    # slow OpenAlex lookups are cached between runs so monthly runs stay cheap and a failure
    # (e.g. OpenAlex rate limits) never wipes what we already know
    cache_path = Path(args.scholar_cache).parent / "openalex_cache.json"
    oa_cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    slow_days = int(st.get("slow_refresh_days", 20))
    if not args.from_raw and key and scholar and st.get("recover_from_scholar", True):
        print("Looking up Scholar papers OpenAlex didn't list...")
        try:
            recover_missing_papers(OpenAlex(key), raw, scholar, oa_cache, max_age_days=60)
        except Exception as e:
            print(f"  ! recovery step failed: {e}", file=sys.stderr)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(oa_cache, separators=(",", ":"), ensure_ascii=False))
    data = build(cfg, raw, scholar)
    data["citing"] = citing_for(data, raw.get("citing"), oa_cache, "citing", key, args, slow_days, st, Path(args.out) / "data.json")
    if not data["citing"]:
        data.pop("citing")
    venues_path = Path(args.config).parent / "venues.yaml"
    enrich_data(data, raw, cfg, venues_path, Path(args.scholar_cache).parent,
                oa_cache, key, online=not args.from_raw)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "data.json").write_text(json.dumps(data, separators=(",", ":")))
    hist = update_history(data, out / "history.json")
    s = data["summary"]
    print(f"Wrote {out/'data.json'}: {s['members']} members, {s['works']} papers, "
          f"{s['citations']} citations, lab h-index {s['h']} [{s['source']}]; {len(hist)} monthly snapshot(s)")

    # --- the same site, counting only papers published from a given year (lab.yaml: lab -> since)
    since = (cfg.get("lab") or {}).get("since")
    try:   # 'since: 2020' or 'since: {year: 2020, reason: ...}'; anything else turns the extra view off
        since_year = int((since.get("year") if isinstance(since, dict) else since) or 0)
    except (TypeError, ValueError):
        print(f"::warning::lab.yaml 'since' should be a year, e.g. 2020 (got {since!r}); the extra view is skipped.")
        since_year = 0
    if since_year:
        try:
            year_fix = {}
            try:   # corrected years in venues.yaml ('papers:') decide which side of the cut a paper falls
                vy = yaml.safe_load(venues_path.read_text()) or {}
                year_fix = {paper_key(k): int(v["year"]) for k, v in (vy.get("papers") or {}).items()
                            if isinstance(v, dict) and v.get("year")}
            except Exception:
                pass
            ds = build(cfg, raw, scholar, since=since_year, year_fix=year_fix)
            ds["citing"] = citing_for(ds, raw.get("citing_since"), oa_cache, "citing_since", key, args, slow_days, st,
                                      out / "data-since.json")
            if not ds["citing"]:
                ds.pop("citing")
            enrich_data(ds, raw, cfg, venues_path, Path(args.scholar_cache).parent, oa_cache, key,
                        online=False, review=False)
            (out / "data-since.json").write_text(json.dumps(ds, separators=(",", ":")))
            update_history(ds, out / "history-since.json")
            s = ds["summary"]
            print(f"Wrote {out/'data-since.json'}: papers from {since_year} on - {s['works']} papers, {s['citations']} citations")
        except Exception as e:   # the extra view must never stop the main site from updating
            import traceback; traceback.print_exc()
            print(f"::warning::the 'since {since_year}' view could not be built ({e}); the main site is unaffected.")
    else:   # view switched off in lab.yaml: remove its old files so the site doesn't keep offering it
        for f in ("data-since.json", "history-since.json"):
            (out / f).unlink(missing_ok=True)
    if not args.from_raw:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(oa_cache, separators=(",", ":"), ensure_ascii=False))


def citing_for(data: dict, citing, oa_cache: dict, ck: str, key, args, slow_days: int, st: dict, prev_path: Path):
    """Countries citing the papers in `data`, cached in openalex_cache.json under `ck`."""
    old = oa_cache.get(ck)
    fresh = old and (dt.date.today() - dt.date.fromisoformat(old.get("checked", "2000-01-01"))).days < slow_days
    if citing is None and fresh:
        citing = old
    elif citing is None and key and not args.from_raw and st.get("citing_countries", True):
        print("Where the lab is cited from...")
        try:
            citing = fetch_citing_countries(OpenAlex(key), [w["id"] for w in data["works"]])
            citing["checked"] = dt.date.today().isoformat()
            oa_cache[ck] = citing
        except Exception as e:  # never lose the map over a failed lookup: keep the last good one
            print(f"  ! citing-countries lookup failed ({e}); keeping the previous map data", file=sys.stderr)
            citing = old
    if citing is None:  # last resort: the map from the currently published data
        if prev_path.exists():
            citing = json.loads(prev_path.read_text()).get("citing")
            if citing:
                oa_cache.setdefault(ck, {**citing, "checked": "2000-01-01"})
    return citing


if __name__ == "__main__":
    main()
