"""
Extra layers for the dashboard, built on top of the OpenAlex/Scholar data:

  * venues   - each paper's output type (journal, conference, ...) and venue quality tier, using the
               reviewed list in venues.yaml, SCImago quartiles (journals) and ICORE ranks (conferences)
  * themes   - what the team works on (OpenAlex keywords + title phrases), for the word cloud
  * scholar  - Google Scholar citation counts on each paper, plus Scholar-only papers for the Papers tab
"""
from __future__ import annotations

import csv
import datetime as dt
import difflib
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

KINDS = ["Journal", "Conference", "Book / chapter", "Preprint / repository", "Other"]
KIND_KEYS = {"journal": "Journal", "conference": "Conference", "book": "Book / chapter",
             "preprint": "Preprint / repository", "other": "Other"}
KEY_OF_KIND = {v: k for k, v in KIND_KEYS.items()}

SCIMAGO_URL = "https://www.scimagojr.com/journalrank.php?out=xls"
ICORE_URL = ("https://portal.core.edu.au/conf-ranks/?search=&by=all&source={src}"
             "&sort=atitle&page=1&do=Export")
ICORE_SOURCES = ["ICORE2026", "ICORE2025", "CORE2023"]


def norm(t: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def jnorm(t: str | None) -> str:
    """Journal-name key: '&' = 'and', a leading 'The' and punctuation ignored."""
    t = re.sub(r"&", " and ", (t or "").lower())
    t = re.sub(r"^the\s+", "", t.strip())
    return re.sub(r"[^a-z0-9]+", "", t)


def log(msg: str) -> None:
    print(msg, file=sys.stderr if msg.startswith("  !") else sys.stdout)


# =============================================================== output type
CONF_HINT = re.compile(r"\b(proceedings|conference|symposium|workshop|congress|colloquium|summit)\b|ascilite|"
                       r"lecture notes|communications in computer and information science|"
                       r"advances in intelligent systems|ceur", re.I)
NOT_CONF = re.compile(r"journal|royal society|academy of sciences|transactions", re.I)
REPO_HINT = re.compile(r"arxiv|rxiv|figshare|repository|ssrn|researchgate|zenodo|minerva access|eprints|\bosf\b|"
                       r"preprint|research online|digital commons|research portal|pure portal|"
                       r"research bank|opus|scholarworks|dspace", re.I)
BOOK_HINT = re.compile(r"\bebooks?\b|\bbooks\b|\bhandbook|encyclopedia", re.I)


def scholar_venue_name(s: str | None) -> str:
    """Google Scholar's 'publication' string without volume, issue, pages and year."""
    t = (s or "").strip()
    t = re.split(r"\s+\d+\s*\(|\s+\d+\s*,|,\s*\d|,\s*$|\s+\d+\s*$|\s+\d{4}\b.*$", t)[0]
    t = re.sub(r"\s*(\.{3}|…)\s*$", "", t).strip(" ,.;")
    t = re.sub(r"^(19|20)\d{2}\s+", "", t)                      # "2024 SEFI Annual Conference"
    t = re.sub(r"^(proceedings of (the )?|the )?\d+(st|nd|rd|th)\s+",
               lambda m: "Proceedings of the " if (m.group(1) or "").lower().startswith("proc") else "", t, flags=re.I)
    return t


def scholar_venue_trustworthy(raw: str | None, name: str) -> bool:
    """Only trust Scholar's venue when it looks like a real journal or conference (not an institution,
    a thesis or a report): a journal/conference word in the name, or a volume (issue) pattern."""
    if not name or len(name) < 4:
        return False
    if re.search(r"\b(universit[yi]|institute|school of|department|faculty|college|parkville|thesis|dissertation)\b", name, re.I) \
            and not re.search(r"journal|conference|proceedings|press", name, re.I):
        return False
    return bool(re.search(r"journal|transactions|review|letters|quarterly|magazine|society|bulletin|annals|"
                          r"proceedings|conference|symposium|workshop|congress", name, re.I)
                or re.search(r"\d+\s*\(\d+\)", raw or ""))


def scholar_venue_kind(s: str) -> str:
    if REPO_HINT.search(s) or re.search(r"\barxiv\b|preprint", s, re.I):
        return "Preprint / repository"
    if CONF_HINT.search(s) and not NOT_CONF.search(s):
        return "Conference"
    return "Journal"


# Publishers' proceedings series: OpenAlex files the paper under the series, not the conference it came from
SERIES = re.compile(r"lecture notes|communications in computer and information science|advances in intelligent systems|"
                    r"ifip advances|smart innovation|studies in computational intelligence|ceur workshop|"
                    r"frontiers in artificial intelligence and applications|springer proceedings|springer ebooks|"
                    r"advances in social science, education and humanities|lecture notes in educational technology", re.I)


def openalex_kind(work_type: str | None, venue_type: str | None) -> str:
    t, v = work_type or "", venue_type or ""
    if t == "preprint" or v == "repository":
        return "Preprint / repository"
    if t in ("book-chapter", "book"):
        return "Book / chapter"
    if t == "conference-paper" or v == "conference":
        return "Conference"
    if v in ("book series", "ebook platform"):
        return "Book / chapter"
    if v == "journal" or t in ("article", "review"):
        return "Journal"
    return "Other"


def suggest_kind(name: str, oa_kind: str) -> str:
    if REPO_HINT.search(name):
        return "Preprint / repository"
    if CONF_HINT.search(name) and not NOT_CONF.search(name):
        return "Conference"
    if BOOK_HINT.search(name) and oa_kind != "Journal":
        return "Book / chapter"
    return oa_kind


# =============================================================== rankings
def _fetch(url: str) -> str | None:
    try:
        import requests
        r = requests.get(url, timeout=120, headers={"User-Agent": "lab-dashboard (GitHub Actions)"})
        if r.status_code == 200 and len(r.content) > 1000:
            return r.content.decode("utf-8-sig", errors="replace")
        log(f"  ! {url[:60]}... answered {r.status_code}")
    except Exception as e:
        log(f"  ! could not download {url[:60]}...: {e}")
    return None


def _stale(path: Path, days: int) -> bool:
    if not path.exists():
        return True
    age = dt.datetime.now().timestamp() - path.stat().st_mtime
    return age > days * 86400


def refresh_rankings(folder: Path, days: int = 180) -> None:
    """Download SCImago and ICORE lists at most every `days` days. Failures keep the old files.
    You can also drop the files in by hand: data/rankings/scimago.csv, icore.csv, abdc.csv."""
    folder.mkdir(parents=True, exist_ok=True)
    sj = folder / "scimago.csv"
    if _stale(sj, days):
        txt = _fetch(SCIMAGO_URL)
        if txt and "SJR Best Quartile" in txt[:2000]:
            # keep only what's needed (title, ISSN, quartile) so the repo stays small
            rows = csv.DictReader(io.StringIO(txt), delimiter=";")
            out = io.StringIO()
            wr = csv.writer(out, delimiter=";")
            wr.writerow(["Title", "Issn", "SJR Best Quartile"])
            for r in rows:
                if (r.get("SJR Best Quartile") or "") in ("Q1", "Q2", "Q3", "Q4"):
                    wr.writerow([r.get("Title", ""), r.get("Issn", ""), r["SJR Best Quartile"]])
            sj.write_text(out.getvalue())
            log("Rankings: SCImago journal list updated")
        else:
            log("  ! SCImago list not refreshed; using the saved copy if there is one")
    ic = folder / "icore.csv"
    if _stale(ic, days):
        for src in ICORE_SOURCES:
            txt = _fetch(ICORE_URL.format(src=src))
            if txt and txt.count("\n") > 100 and re.search(r'"(A\*|A|B|C)"', txt):
                ic.write_text(txt)
                log(f"Rankings: ICORE conference list updated ({src})")
                break
        else:
            log("  ! ICORE list not refreshed; using the saved copy if there is one")


def _issn(s: str) -> str:
    s = re.sub(r"[^0-9Xx]", "", s or "").upper()
    return f"{s[:4]}-{s[4:]}" if len(s) == 8 else ""


def load_rankings(folder: Path) -> dict:
    out = {"sj_issn": {}, "sj_title": {}, "icore": [], "abdc_issn": {}, "abdc_title": {}, "cj_issn": {}, "cj_title": {}}
    sj = folder / "scimago.csv"
    if sj.exists():
        rows = csv.DictReader(io.StringIO(sj.read_text()), delimiter=";")
        for r in rows:
            q = (r.get("SJR Best Quartile") or "").strip()
            if q not in ("Q1", "Q2", "Q3", "Q4"):
                continue
            for i in (r.get("Issn") or "").split(","):
                if _issn(i):
                    out["sj_issn"][_issn(i)] = q
            out["sj_title"][jnorm(r.get("Title"))] = q
    # icore.csv first, then any older CORE exports (e.g. core2023.csv for fields ICORE 2026 no longer ranks)
    files = sorted(folder.glob("*core*.csv"), key=lambda f: (f.name != "icore.csv", f.name))
    seen = set()
    for ic in files:
        for r in csv.reader(io.StringIO(ic.read_text(encoding="utf-8-sig", errors="replace"))):
            if len(r) < 5:
                continue
            title, acr, src, rank = r[1].strip(), r[2].strip(), r[3].strip(), r[4].strip()
            rank = "Australasian" if rank.lower().startswith("australasian") else rank
            key = (acr.upper(), clean_conf(title))
            if rank in ("A*", "A", "B", "C", "Australasian") and key not in seen:
                seen.add(key)
                out["icore"].append({"title": title, "acr": acr, "rank": rank, "src": src or ic.stem, "clean": clean_conf(title)})
    ab = folder / "abdc.csv"
    if ab.exists():  # optional, added by hand: columns must include an ISSN and a rating column
        for r in csv.DictReader(io.StringIO(ab.read_text())):
            keys = {k.lower(): k for k in r}
            rating = (r.get(keys.get("rating", ""), "") or r.get(keys.get("2022 rating", ""), "") or "").strip()
            if rating not in ("A*", "A", "B", "C"):
                continue
            for k in keys:
                if "issn" in k and _issn(r[keys[k]]):
                    out["abdc_issn"][_issn(r[keys[k]])] = rating
            t = next((r[keys[k]] for k in keys if "title" in k), "")
            out["abdc_title"][jnorm(t)] = rating
    cj = folder / "core_journals.csv"
    if cj.exists():  # CORE journal list (A*/A/B/C; last updated 2020, older entries from ERA 2010)
        for r in csv.DictReader(io.StringIO(cj.read_text(encoding="utf-8-sig", errors="replace"))):
            rank = (r.get("rank") or "").strip()
            if rank not in ("A*", "A", "B", "C"):
                continue
            src = (r.get("source") or "CORE").strip()
            for k in ("ISSN1", "ISSN2", "ISSN3", "ISSN4"):
                if _issn(r.get(k) or ""):
                    out["cj_issn"][_issn(r[k])] = (rank, src)
            out["cj_title"][jnorm(r.get("title"))] = (rank, src)
    log(f"Rankings loaded: {len(out['sj_issn'])} SCImago ISSNs, {len(out['icore'])} ICORE conferences, "
        f"{len(out['abdc_issn'])} ABDC ISSNs, {len(out['cj_title'])} CORE journals")
    return out


def clean_conf(name: str) -> str:
    t = (name or "").lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"\b(proceedings of( the)?|proc\.|annual|the|\d{4}|\d+(st|nd|rd|th)|ieee|acm)\b", " ", t)
    return re.sub(r"[^a-z]+", " ", t).strip()


SIDE_TRACK = re.compile(r"extended abstracts|companion|adjunct|workshops?\b|doctoral|posters?|demos?|tutorials?|"
                        r"spring symposium|fall symposium|summer school|^findings of", re.I)
CONF_STOP = set("""international conference proceedings annual symposium workshop joint the and for ieee acm on of in
at with world national european asian australasian australian pacific""".split())


def _sig(text: str) -> set:
    t = re.sub(r"\(.*?\)", " ", (text or "").lower())
    return {w for w in re.findall(r"[a-z]{3,}", t) if w not in CONF_STOP}


def match_conference(name: str, icore: list) -> tuple[str | None, str | None, float]:
    """Rank of a conference from ICORE/CORE.
    1. Acronym: written exactly as ICORE writes it, or equal to the venue's own acronym in brackets,
       AND the two names must share most of their key words (so ICIS the IEEE conference is not
       mistaken for ICIS the AIS one). A name that is just the acronym ("Proceedings of AAMAS") is fine.
    2. Otherwise a near-identical full name.
    Workshops, companions, extended abstracts etc. of a ranked conference do NOT get its rank."""
    name = name or ""
    own = {m.upper() for m in re.findall(r"\(([A-Za-z@&\-]{3,})\)", name)}
    vs = _sig(name)
    best, note = None, None
    for e in icore:
        a = e["acr"]
        if len(a) < 3:
            continue
        hit = a.upper() in own or re.search(rf"(?<![A-Za-z]){re.escape(a)}(?![A-Za-z])", name)
        if not hit:
            continue
        es = _sig(e["title"])
        only_acronym = vs <= {a.lower()} or not (vs - {a.lower()})
        cover = min(len(vs & es) / max(1, len(es)), len((vs - {a.lower()}) & es) / max(1, len(vs - {a.lower()})))
        if only_acronym or cover >= 0.5:
            if not best or len(a) > len(best["acr"]):
                best = e
        elif not note:
            note = f"maybe ICORE: {e['title']} ({e['rank']}) - acronym {a} matches but the names differ"
    if best:
        if SIDE_TRACK.search(name):
            return None, f"side event of {best['acr']} ({best['rank']} in {best.get('src', 'ICORE')}) - main-track rank not applied", 0.0
        return best["rank"], f"{best.get('src', 'ICORE')} acronym {best['acr']}", 1.0
    c = clean_conf(name)
    top = (None, None, 0.0)
    if len(c) >= 12:
        for e in icore:
            sm = difflib.SequenceMatcher(None, c, e["clean"])
            if sm.real_quick_ratio() < 0.85 or sm.quick_ratio() < 0.85:
                continue
            r = sm.ratio()
            if r > top[2]:
                top = (e["rank"], e["title"], r)
    if top[2] >= 0.95 and not SIDE_TRACK.search(name):
        return top[0], f"ICORE title ({top[1]})", top[2]
    if top[2] >= 0.85:
        note = note or f"maybe ICORE: {top[1]} ({top[0]})"
    return None, note, top[2]


def tier_of(kind: str, rank: str | None) -> str:
    r = (rank or "").strip()
    if kind == "Journal":
        return f"{r} journals" if r in ("Q1", "Q2", "Q3", "Q4", "A*", "A", "B", "C") else "Unranked journals"
    if kind == "Conference":
        if r in ("A*", "A", "B", "C"):
            return f"{r} conferences"
        return "Australasian conferences" if r == "Australasian" else "Unranked conferences"
    return {"Book / chapter": "Books (not ranked)", "Preprint / repository": "Not peer-reviewed"}.get(kind, "Other outputs")


TIER_ORDER = ["Q1 journals", "Q2 journals", "Q3 journals", "Q4 journals", "CORE A* journals", "CORE A journals",
              "CORE B journals", "CORE C journals", "A* journals", "A journals", "B journals",
              "C journals", "Unranked journals", "A* conferences", "A conferences", "B conferences", "C conferences",
              "Australasian conferences", "Unranked conferences", "Books (not ranked)", "Not peer-reviewed",
              "Other outputs"]


# =============================================================== venues
def load_venue_list(path: Path) -> tuple[dict, dict]:
    if not path.exists():
        return {}, {}
    y = yaml.safe_load(path.read_text()) or {}
    aliases = {norm(k): v for k, v in (y.get("aliases") or {}).items()}
    venues = {}
    for v in y.get("venues") or []:
        if isinstance(v, dict) and v.get("name"):
            venues[norm(v["name"])] = v
    return aliases, venues


def _paper_key(s: str | None) -> str:
    """A DOI in any spelling ('https://doi.org/10.1/X', '10.1/x') -> '10.1/x'; anything else -> a title key."""
    s = (s or "").strip().lower()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s)
    return s if s.startswith("10.") else "t:" + norm(s)


def load_paper_overrides(path: Path) -> dict:
    """venues.yaml 'papers:' - corrections for single papers, keyed by DOI (or by exact title):
         papers:
           "10.1145/3701716.3716878": {rank: "unranked"}
           "10.25916/sut.26291413": {rank: "unranked", year: 2004}
       Fields: rank, type, venue (move the paper to another venue name), year."""
    if not path.exists():
        return {}
    y = yaml.safe_load(path.read_text()) or {}
    return {_paper_key(k): (v or {}) for k, v in (y.get("papers") or {}).items() if isinstance(v, dict)}


def apply_venues(data: dict, raw_sources: dict, venues_path: Path, data_dir: Path, settings: dict, impact: dict,
                 online: bool = True, review: bool = True) -> None:
    """Give each work a canonical venue, output type and quality tier; add data['venues']."""
    aliases, listed = load_venue_list(venues_path)
    rank_dir = data_dir / "rankings"
    if online and settings.get("venue_rankings", True):
        refresh_rankings(rank_dir, int(settings.get("rankings_refresh_days", 180)))
    R = load_rankings(rank_dir)
    this_year = dt.date.today().year
    venues: dict[str, dict] = {}
    # Papers that are on Scholar profiles but not in OpenAlex at all: count them too when Scholar says
    # where they were published (they have no co-author details, so they only add to counts and flows)
    keep_extra, n_added = [], 0
    for i, e in enumerate(data.get("extra_papers") or []):
        vname = scholar_venue_name(e.get("v"))
        if e.get("y") and scholar_venue_trustworthy(e.get("v"), vname) and scholar_venue_kind(vname) != "Preprint / repository":
            data["works"].append({"id": f"GS{i}", "title": e["t"], "year": e["y"], "doi": e.get("u"), "type": None,
                                  "venue": None, "venue_type": None, "cited_by_count": e["c"], "gs_c": e["c"],
                                  "gs_v": e["v"], "cby": {}, "authors": [], "versions": 1, "lab": e["m"],
                                  "scholar_only": True})
            n_added += 1
        else:
            keep_extra.append(e)
    data["extra_papers"] = keep_extra
    log(f"Venues: added {n_added} Scholar-only papers with a known venue")
    # per-paper corrections from venues.yaml: venue and year first (they decide where a paper is counted)
    P = load_paper_overrides(venues_path)
    for w in data["works"]:
        o = P.get(_paper_key(w.get("doi"))) or P.get(_paper_key(w.get("title")))
        if not o:
            continue
        w["_override"] = o
        if o.get("year"):
            w["year"] = int(o["year"])
        if o.get("venue"):
            w["venue"], w["venue_type"] = str(o["venue"]), None
            w.pop("gs_v", None)
    if P:
        log(f"Paper corrections: {sum(1 for w in data['works'] if w.get('_override'))} of {len(P)} applied")
    vkey = lambda n: norm(re.sub(r"&", " and ", re.sub(r"^the\s+", "", n or "", flags=re.I)))
    known = {vkey(w["venue"]): w["venue"] for w in data["works"] if w.get("venue")}
    for w in data["works"]:
        name = w.get("venue") or ""
        oa_kind = openalex_kind(w.get("type"), w.get("venue_type"))
        gs_name = scholar_venue_name(w.get("gs_v"))
        if (not name or oa_kind == "Preprint / repository" or SERIES.search(name)) \
                and scholar_venue_trustworthy(w.get("gs_v"), gs_name) and not SERIES.search(gs_name) \
                and scholar_venue_kind(gs_name) != "Preprint / repository":
            # OpenAlex has only a preprint, nothing, or the publisher's series (e.g. LNCS) - Scholar names the venue
            w["venue_from"] = "Google Scholar"
            if SERIES.search(name or "") and oa_kind == "Conference":
                oa_kind = "Conference"
            else:
                oa_kind = scholar_venue_kind(gs_name)
            name = known.get(vkey(gs_name), gs_name)
        if not name:
            w.update({"kind": oa_kind, "tier": tier_of(oa_kind, None), "vkey": None})
            continue
        canon = aliases.get(norm(name), name)
        entry = listed.get(norm(canon))
        label = (entry or {}).get("label") or canon
        v = venues.get(label)
        if not v:
            if entry and KIND_KEYS.get(str(entry.get("type", "")).lower()):
                kind = KIND_KEYS[str(entry["type"]).lower()]
            else:
                kind = suggest_kind(canon, oa_kind)
            rank, src, note = None, None, None
            if entry and entry.get("rank") not in (None, ""):
                rank, src = str(entry["rank"]).strip(), "venues.yaml"
                if rank.lower() == "unranked":
                    rank = None
            elif kind == "Journal":
                issns = [_issn(i) for i in (raw_sources.get(name, {}).get("issn") or [])]
                rank = next((R["sj_issn"][i] for i in issns if i in R["sj_issn"]), None) or R["sj_title"].get(jnorm(canon))
                src = "SCImago" if rank else None
                if not rank:
                    rank = next((R["abdc_issn"][i] for i in issns if i in R["abdc_issn"]), None) or R["abdc_title"].get(jnorm(canon))
                    src = "ABDC" if rank else None
                if not rank:   # last resort: the CORE journal list
                    hit = next((R["cj_issn"][i] for i in issns if i in R["cj_issn"]), None) or R["cj_title"].get(jnorm(canon))
                    if hit:
                        rank, src = hit[0], f"CORE journals ({hit[1]})"
            elif kind == "Conference":
                rank, how, _ = match_conference(canon, R["icore"])
                src = how if rank else None
                note = None if rank else how
            v = venues[label] = {
                "name": label, "canon": canon, "kind": kind, "rank": rank, "src": src, "note": note,
                "tier": (f"CORE {rank} journals" if (src or "").startswith("CORE journals") else tier_of(kind, rank)), "verified": bool(entry and entry.get("reviewed")),
                "listed": bool(entry), "openalex_kind": oa_kind, "names": set(),
                "impact": impact.get(raw_sources.get(name, {}).get("id")), "papers": 0, "recent": 0,
            }
        v["names"].add(name)
        v["papers"] += 1
        v["recent"] += 1 if (w.get("year") or 0) >= this_year - 4 else 0
        w.update({"venue": label, "kind": v["kind"], "tier": v["tier"], "vkey": label})
    # ...then type and rank, which apply to that one paper only
    for w in data["works"]:
        o = w.pop("_override", None)
        if not o:
            continue
        if KIND_KEYS.get(str(o.get("type", "")).lower()):
            w["kind"] = KIND_KEYS[str(o["type"]).lower()]
            v = venues.get(w.get("vkey") or "") or {}
            w["tier"] = tier_of(w["kind"], v.get("rank") if v.get("kind") == w["kind"] else None)
        if "rank" in o:
            r = str(o.get("rank") or "").strip()
            r = "" if r.lower() in ("", "unranked", "none") else r
            w["rank"], w["rank_src"] = r, "venues.yaml (this paper)"
            w["tier"] = tier_of(w["kind"], r or None)
    for v in venues.values():
        v["names"] = sorted(v["names"])
    data["venues"] = venues
    data["tier_order"] = TIER_ORDER
    if review:   # only for the full build, not the 'since' view
        write_review_file(data_dir / "venues_to_review.yaml", venues, listed)


def write_review_file(path: Path, venues: dict, listed: dict) -> None:
    todo = sorted((v for v in venues.values() if not v["verified"]), key=lambda v: (-v["recent"], -v["papers"], v["name"]))
    lines = ["# Venues not yet marked 'reviewed: true' in venues.yaml (generated - do not edit this file).",
             "# Copy any line into venues.yaml, check the type and rank, then set reviewed: true.", "venues:"]
    for v in todo:
        rank = f", rank: \"{v['rank']}\"" if v["rank"] else ""
        lab = f", label: {json.dumps(v['name'], ensure_ascii=False)}" if v["name"] != v["canon"] else ""
        hint = []
        if v["kind"] != v["openalex_kind"]:
            hint.append(f"OpenAlex says {KEY_OF_KIND[v['openalex_kind']]}")
        if v["src"]:
            hint.append(f"rank from {v['src']}")
        if v.get("note"):
            hint.append(v["note"])
        n = v["papers"]
        lines.append(f"  - {{name: {json.dumps(v['canon'], ensure_ascii=False)}{lab}, type: {KEY_OF_KIND[v['kind']]}{rank}, "
                     f"reviewed: false}}  # {n} paper{'' if n == 1 else 's'} ({v['recent']} in the last 5 years)" + (" · " + "; ".join(hint) if hint else ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    log(f"Venues: {len(venues)} in use, {len(todo)} still to review (see data/venues_to_review.yaml)")


def fetch_impact(oa, source_ids: list[str], cache: dict, max_age_days: int = 60) -> dict:
    """OpenAlex 2-year mean citedness per venue (an impact-factor-like number), cached."""
    c = cache.setdefault("impact", {"checked": "2000-01-01", "v": {}})
    fresh = (dt.date.today() - dt.date.fromisoformat(c["checked"])).days < max_age_days
    missing = [s for s in source_ids if s and s not in c["v"]]
    if fresh and not missing:
        return c["v"]
    todo = sorted(set(source_ids if not fresh else missing))
    try:
        for i in range(0, len(todo), 50):
            res = oa.get("/sources", filter="openalex:" + "|".join(todo[i:i + 50]), per_page=50,
                         select="id,summary_stats") or {}
            for s in res.get("results", []):
                sid = s["id"].rsplit("/", 1)[-1]
                c["v"][sid] = round(((s.get("summary_stats") or {}).get("2yr_mean_citedness") or 0), 2)
        c["checked"] = dt.date.today().isoformat()
    except Exception as e:
        log(f"  ! venue impact lookup stopped: {e}")
    return c["v"]


# =============================================================== Scholar citations on papers
def clean_title(t: str | None) -> str:
    """Drop markup some records carry in titles, e.g. '$\\mathsf {DisIMS}$ DisIMS: ...' or '<i>...</i>'."""
    t = re.sub(r"\$[^$]*\$", " ", t or "")
    return re.sub(r"<[^>]+>", " ", t)


def same_paper(a: str, ya, b: str, yb) -> bool:
    """a, b: normalised titles. Same paper if identical; or one is the other plus a subtitle (years within 2);
    or nearly identical, e.g. a typo or one changed word (years within 2)."""
    if a == b:
        return True
    if not a or not b or abs((ya or yb or 0) - (yb or ya or 0)) > 2:
        return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 18 and long_.startswith(short):
        return True
    if abs(len(a) - len(b)) <= 0.1 * max(len(a), len(b)) and len(short) >= 18:
        sm = difflib.SequenceMatcher(None, a, b)
        return sm.real_quick_ratio() >= 0.92 and sm.quick_ratio() >= 0.92 and sm.ratio() >= 0.92
    return False


def attach_scholar(data: dict, nt) -> None:
    key = lambda t: nt(clean_title(t))
    gs: dict[str, dict] = {}
    for m in data["members"]:
        for p in m.get("scholar_papers") or []:
            k = key(p["title"])
            if not k:
                continue
            # the same paper can be listed twice on a profile, or on two members' profiles with slightly
            # different titles: fold those into one entry
            hit = k if k in gs else next((g for g in gs if same_paper(k, p.get("year"), g, gs[g]["y"])), None)
            if hit is None:
                gs[k] = {"t": p["title"], "y": p.get("year"), "v": p.get("venue"), "c": 0, "u": p.get("link"), "m": set()}
                hit = k
            e = gs[hit]
            e["c"] = max(e["c"], p.get("c") or 0)
            e["v"] = e["v"] or p.get("venue")
            e["m"].add(m["slug"])
    used = set()
    by_len = sorted(gs, key=len)

    def find(w):
        t = key(w["title"])
        if t in gs and t not in used:
            return t
        y = w.get("year")
        return next((k for k in by_len if k not in used and same_paper(t, y, k, gs[k]["y"])), None)

    for w in data["works"]:
        k = find(w)
        if k:
            e = gs[k]
            w["gs_c"] = e["c"]
            if e.get("v"):
                w["gs_v"] = e["v"]
            used.add(k)
    data["extra_papers"] = sorted(({"t": e["t"], "y": e["y"], "v": e["v"], "c": e["c"], "u": e["u"], "m": sorted(e["m"])}
                                   for k, e in gs.items() if k not in used), key=lambda e: -e["c"])


# =============================================================== themes
STOP = set("""a an the of in on for and to with from by at as is are was were be been being using used via towards toward
its it their our we this that these those case study studies approach approaches based through into among between how what
why when where which who do does can could should would will about factors beliefs new analysis research role impact effect
effects within across over under beyond versus vs not no more less than both two three one first second part paper report
review reviews systematic literature perspective perspectives exploring explore exploratory investigating investigation
toward framework frameworks model models modelling modeling method methods evaluation evaluating examining insights lessons
evidence challenges opportunities implications future current emerging practice practices issue issues proceedings
conference journal international annual introduction overview towards developing development designing enhancing improving
supporting support""".split())
ONE_OK = set("""chatgpt blockchain gamification cybersecurity metaverse plagiarism accessibility sustainability telehealth ehealth
mhealth ontology prolog mooc feedback assessment wellbeing""".split())
KEEP_S = set("analytics analysis ethics process class physics series mathematics business access sciences dynamics".split())
SYN = {"genai": "generative ai", "generative artificial intelligence": "generative ai", "llm": "large language model",
       "artificial intelligence": "ai", "learning analytic": "learning analytics"}
GENERIC_KW = {"computer science", "psychology", "education", "engineering", "mathematics", "business", "management",
              "sociology", "pedagogy", "medicine", "context archaeology", "process", "computer", "student", "teaching",
              "learning", "research", "knowledge", "technology", "information", "data", "design", "software"}


def _sing(w: str) -> str:
    return w[:-1] if w.endswith("s") and not w.endswith("ss") and w not in KEEP_S and len(w) > 3 else w


def _key(text: str, merges: dict) -> str:
    k = " ".join(_sing(t) for t in re.findall(r"[a-z][a-z0-9\-']*", text.lower()))
    k = SYN.get(k, k)
    return merges.get(k, k)


def build_themes(data: dict, settings: dict, nt) -> None:
    this_year = dt.date.today().year
    years = int(settings.get("themes_years", 5))
    FROM, TO = this_year - years + 1, this_year
    merges = {_key(a, {}): _key(b, {}) for a, b in (settings.get("themes_merge") or {}).items()}
    exclude = {_key(x, merges) for x in settings.get("themes_exclude") or []}
    papers: dict[str, dict] = {}
    for w in data["works"]:
        if w.get("year") and FROM <= w["year"] <= TO:
            papers[nt(w["title"])] = {"t": w["title"], "y": w["year"], "m": set(w["lab"]), "u": w.get("doi"),
                                      "kw": w.get("kw") or [], "field": w.get("field")}
    for m in data["members"]:
        for p in m.get("scholar_papers") or []:
            if p.get("year") and FROM <= p["year"] <= TO:
                k = nt(p["title"])
                e = papers.setdefault(k, {"t": p["title"], "y": p["year"], "m": set(), "u": p.get("link"), "kw": [], "field": None})
                e["m"].add(m["slug"])
    surface: dict[str, Counter] = defaultdict(Counter)
    df, mem, plist, fields, from_kw = Counter(), defaultdict(set), defaultdict(list), defaultdict(Counter), set()
    for k, p in papers.items():
        grams = set()
        toks = re.findall(r"[A-Za-z][A-Za-z0-9\-']*|[:;,.?!()\[\]|–—/]", p["t"])
        segs, cur = [], []
        for tok in toks:
            lo = tok.lower().strip("'")
            if not re.match(r"[a-z]", lo) or lo in STOP:
                if cur:
                    segs.append(cur)
                cur = []
            else:
                cur.append((_sing(lo), tok))
        if cur:
            segs.append(cur)
        for s in segs:
            for n in (1, 2, 3):
                for i in range(len(s) - n + 1):
                    g = s[i:i + n]
                    key = merges.get(SYN.get(" ".join(x for x, _ in g), " ".join(x for x, _ in g)),
                                     SYN.get(" ".join(x for x, _ in g), " ".join(x for x, _ in g)))
                    grams.add(key)
                    surface[key][" ".join(o for _, o in g)] += 1
        for kw in p["kw"]:
            key = _key(kw, merges)
            if key and key not in GENERIC_KW:
                grams.add(key)
                from_kw.add(key)
                surface[key][kw] += 3
        for g in grams:
            df[g] += 1
            mem[g] |= p["m"]
            plist[g].append(k)
            if p["field"]:
                fields[g][p["field"]] += 1
    cand = {g: c for g, c in df.items() if g not in exclude and len(g) > 2 and (
        (len(g.split()) >= 2 and c >= 2) or (len(g.split()) == 1 and c >= 2 and (g in ONE_OK or g in from_kw)))}
    keep: dict[str, int] = {}
    for g, c in sorted(cand.items(), key=lambda x: -len(x[0].split())):
        if any(keep[h] >= 0.6 * c for h in keep if f" {g} " in f" {h} "):
            continue
        keep[g] = c
    for g in [g for g in keep if len(g.split()) == 1 and g not in from_kw]:
        if sum(keep[h] for h in keep if h != g and f" {g} " in f" {h} ") >= 0.5 * keep[g]:
            del keep[g]
    if "ai" in keep and "generative ai" in keep:
        del keep["ai"]

    def label(g: str) -> str:
        if g == "generative ai":
            return "Generative AI"
        if g == "large language model":
            return "Large language models"
        if g == "ai":
            return "AI"
        s = surface[g].most_common(1)[0][0] if surface[g] else g
        s = " ".join(w if (w.isupper() and len(w) > 1) or re.search(r"[A-Z].*[A-Z]", w[1:] or "") else w.lower()
                     for w in s.split())
        return s[:1].upper() + s[1:]

    plist_keys = sorted(papers)
    idx = {k: i for i, k in enumerate(plist_keys)}
    items = sorted(({"k": g, "label": label(g), "n": c, "m": sorted(mem[g]),
                     "field": (fields[g].most_common(1)[0][0] if fields[g] else None),
                     "p": [idx[k] for k in sorted(plist[g], key=lambda k: -(papers[k]["y"] or 0))][:40]}
                    for g, c in keep.items()), key=lambda t: (-len(t["m"]), -t["n"]))[:80]
    data["themes"] = {"from": FROM, "to": TO, "items": items,
                      "papers": [{"t": papers[k]["t"], "y": papers[k]["y"], "u": papers[k]["u"],
                                  "m": sorted(papers[k]["m"])} for k in plist_keys],
                      "source": "keywords" if from_kw else "titles"}
    log(f"Themes: {len(items)} themes from {len(papers)} papers ({FROM}-{TO}), "
        f"{sum(1 for t in items if len(t['m']) >= 2)} shared by 2+ members")
