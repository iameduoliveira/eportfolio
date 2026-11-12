"""Build site/data/research.json for the Home and Research pages.

Input:  data/dashboard/data.json   (written monthly by pipeline/fetch.py)
        content/themes.yaml        (themes, topics and your per-paper corrections)
Output: site/data/research.json

Google Scholar decides which papers exist, their years and citations. OpenAlex adds the type,
venue, rank and co-authors where it knows the paper; otherwise those come from the Scholar record.
"""
import collections, json, re, sys, unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "dashboard" / "data.json"
THEMES = ROOT / "content" / "themes.yaml"
OUT = ROOT / "site" / "data" / "research.json"
SLUG = "eduardo-oliveira"

TIER = {"A* conferences": "CORE A*", "A conferences": "CORE A", "B conferences": "CORE B", "C conferences": "CORE C",
        "Q1 journals": "Q1", "Q2 journals": "Q2", "Q3 journals": "Q3", "Q4 journals": "Q4", "CORE A journals": "CORE A"}
SHORT = {  # long venue names -> what the page shows
    "International Conference on Artificial Intelligence in Education": "AIED",
    "Koli Calling International Conference on Computing Education Research": "Koli Calling",
    "International Conference on Learning Analytics and Knowledge (LAK)": "LAK",
    "International Conference on Learning Analytics and Knowledge": "LAK",
    "ASCILITE (conference proceedings)": "ASCILITE", "ASCILITE Publications": "ASCILITE",
    "ACM/IEEE International Conference on Software Engineering: Companion Proceedings (ICSE-Companion)": "ICSE Companion",
    "Computers and Education Artificial Intelligence": "Computers & Education: AI",
    "Australasian Association for Engineering Education Annual Conference": "AAEE",
    "Anais do ... Simpósio Brasileiro de Informática na Educação/Anais do Simpósio Brasileiro de Informática na Educação":
        "SBIE (Brazilian Symposium on Computers in Education)",
}
AWARDS = {"unpacking vibe coding": "Best Student Paper, AIED 2026", "writing under pressure": "Best Paper, ICSLE 2025",
          "creating a software application to help university educators": "Best Concise Paper, ASCILITE 2023"}


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", (s or "").lower()).encode("ascii", "ignore").decode())


def key(s):
    return " ".join(norm(s).split()[:8])


def gs_venue(v):
    if not v:
        return ""
    return re.split(r",\s*\d|\s\d+\s*\(|\s\d{1,4},|\s\d{4}$", v)[0].strip(" ,")


def gs_kind(v):
    l = (v or "").lower()
    if re.search(r"arxiv|ssrn|preprint|available at|osf|psyarxiv|edarxiv", l):
        return "Preprint & other"
    if re.search(r"advanced learning analytics methods|chapter|book|handbook|open educational practices", l):
        return "Book chapter"
    if re.search(r"proceedings|conference|symposium|workshop|congress|\bconf\b|summit|ascilite|lak|koli", l):
        return "Conference"
    if re.search(r"journal|computers|education|transactions|letters|information|mathematics|technology|behavior|research", l):
        return "Journal"
    return "Preprint & other"


def main():
    if not SRC.exists():
        sys.exit(f"{SRC} not found - run pipeline/fetch.py --out data/dashboard first")
    d = json.loads(SRC.read_text())
    cfg = yaml.safe_load(THEMES.read_text())
    themes = [(t["code"], re.compile(t["keywords"])) for t in cfg["themes"]]
    overrides = {key(p["title"]): p.get("themes") or [] for p in (cfg.get("papers") or []) if p.get("title")}

    m = next(x for x in d["members"] if x["slug"] == SLUG)
    my_ids = set(m.get("openalex") or [])
    oa = [w for w in d["works"] if SLUG in w.get("lab", [])]
    oa_by = {key(w["title"]): w for w in oa}

    inst = {n["id"]: (n.get("inst") or ("The University of Melbourne" if n.get("lab") else "")) for n in d["network"]["nodes"]}
    names, abbr = {}, collections.defaultdict(set)
    for w in oa:
        for a in w["authors"]:
            if not a.get("id") or a["id"] in my_ids:
                continue
            names[a["id"]] = a["name"]
            p = norm(a["name"]).split()
            if p:
                abbr[(p[0][0], p[-1])].add(a["id"])

    def gs_ids(s):
        out = []
        for tok in (s or "").split(","):
            p = norm(tok).split()
            ids = abbr.get((p[0][0], p[-1])) if len(p) >= 2 else None
            if ids and len(ids) == 1:
                out.append(next(iter(ids)))
        return out

    works, matched = [], 0
    for g in m.get("scholar_papers") or []:
        k = key(g["title"])
        w = oa_by.get(k) or next((v for kk, v in oa_by.items() if kk[:40] == k[:40]), None)
        tl = g["title"].lower()
        if w:
            matched += 1
            co = [a["id"] for a in w["authors"] if a.get("id") and a["id"] not in my_ids and not a["name"].startswith("Eduardo")]
            auth = [a["name"] for a in w["authors"]]
            venue = w.get("venue") or gs_venue(g.get("venue"))
            if re.search(r"ebooks|lecture notes|communications in computer|book series", (venue or "").lower()) and gs_venue(g.get("venue")):
                venue = gs_venue(g.get("venue"))
            kind = {"Journal": "Journal", "Conference": "Conference", "Book / chapter": "Book chapter"}.get(w.get("kind") or "", "Preprint & other")
            tier, doi, af = TIER.get(w.get("tier") or "", ""), w.get("doi") or "", ", ".join(auth)
        else:
            co, venue, kind, tier, doi = gs_ids(g.get("authors")), gs_venue(g.get("venue")), gs_kind(g.get("venue")), "", ""
            af = (g.get("authors") or "").replace(", ...", ", et al.")
        th = overrides[k] if k in overrides else [c for c, rx in themes if rx.search(tl)]
        works.append({"t": g["title"], "y": g.get("year") or 0, "c": g.get("c") or 0, "k": kind, "v": SHORT.get(venue, venue),
                      "vfull": venue, "tier": tier, "th": th, "af": af, "doi": doi, "gs": g.get("link", ""),
                      "href": doi or g.get("link", ""), "aw": next((v for kk, v in AWARDS.items() if kk in tl), None),
                      "co": sorted(set(co))})
    vt = {w["v"]: w["tier"] for w in works if w["tier"]}
    for w in works:
        w["tier"] = w["tier"] or vt.get(w["v"], "")
    works.sort(key=lambda w: (-w["y"], -w["c"]))

    # co-author network (people with 2+ shared papers) and institutions (papers written together)
    coauth, copapers, fy = collections.Counter(), collections.defaultdict(list), {}
    for i, w in enumerate(works):
        for a in w["co"]:
            coauth[a] += 1
            copapers[a].append(i)
            if w["y"]:
                fy[a] = min(fy.get(a, 9999), w["y"])
    ip = collections.Counter()
    for w in works:
        for s in {inst.get(a) for a in w["co"] if inst.get(a)}:
            ip[s] += 1
    keep = [a for a, n in coauth.items() if n >= 2]
    keepset = set(keep)
    ew = collections.Counter()
    for a in keep:
        ew[("me", a)] = coauth[a]
    for w in works:
        ids = sorted(a for a in w["co"] if a in keepset)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                ew[(ids[i], ids[j])] += 1
    nodes = [{"id": "me", "n": "Eduardo Oliveira", "p": len(works), "inst": "The University of Melbourne", "th": [], "w": [],
              "fy": min((w["y"] for w in works if w["y"]), default=2000)}]
    for a in sorted(keep, key=lambda a: -coauth[a]):
        ths = collections.Counter(t for i in copapers[a] for t in works[i]["th"])
        nodes.append({"id": a, "n": names.get(a, a), "p": coauth[a], "inst": inst.get(a) or "", "th": list(ths), "w": copapers[a], "fy": fy.get(a, 2000)})
    edges = [{"a": a, "b": b, "w": n} for (a, b), n in ew.items()]
    for w in works:
        w["co"] = [a for a in w["co"] if a in keepset]

    # topics word cloud: title keywords + OpenAlex keywords (when the themes step ran)
    words = {t["label"]: {i for i, w in enumerate(works) if re.search(t["keywords"], w["t"].lower())} for t in cfg.get("topics") or []}
    alias = cfg.get("openalex_keywords") or {}
    wkey = {key(w["t"]): i for i, w in enumerate(works)}
    T = d.get("themes") or {}
    for it in T.get("items") or []:
        lab = alias.get(it.get("label"))
        if not lab:
            continue
        for p in it.get("p") or []:
            P = T["papers"][p]
            if SLUG in P.get("m", []) and key(P["t"]) in wkey:
                words.setdefault(lab, set()).add(wkey[key(P["t"])])
    wl = sorted([[l, sorted(s)] for l, s in words.items() if len(s) >= 2], key=lambda x: -len(x[1]))

    cites = sorted((w["c"] for w in works), reverse=True)
    h = max([i + 1 for i, c in enumerate(cites) if c >= i + 1] or [0])
    out = {
        "generated_at": d.get("generated_at"), "scholar_fetched": m.get("scholar_fetched"),
        "headline": {"works": len(works), "citations": sum(cites), "h": m.get("h") or h, "i10": m.get("i10") or sum(1 for c in cites if c >= 10),
                     "coauthors": len(m.get("collab_lab") or {}) + int(m.get("collab_external") or 0), "source": m.get("source", "")},
        "cby": m.get("cites_by_year") or {},
        "themes": [[t["code"], t["label"], t.get("long_label", t["label"]), t.get("description", "")] for t in cfg["themes"]],
        "works": works, "nodes": nodes, "edges": edges, "inst": [[k, v] for k, v in ip.most_common(10)], "words": wl,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(works)} papers ({matched} matched in OpenAlex), {sum(cites)} citations, "
          f"{len(nodes) - 1} frequent co-authors, {len(wl)} topics, {sum(1 for w in works if not w['th'])} papers without a theme")


if __name__ == "__main__":
    main()
