"""Turn the hand-edited content/*.yaml files into site/data/*.json for the pages.

Run after editing any content file:  python scripts/build_content.py
(GitHub Actions runs it on every push, so you only need it to preview locally.)
"""
import json, sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FILES = ["profile", "grants", "awards", "teaching", "talks"]


def main():
    out = ROOT / "site" / "data"
    out.mkdir(parents=True, exist_ok=True)
    ok = True
    for name in FILES:
        src = ROOT / "content" / f"{name}.yaml"
        try:
            data = yaml.safe_load(src.read_text())
        except yaml.YAMLError as e:   # explain the usual hand-editing slip in plain words
            mark = getattr(e, "problem_mark", None)
            line = mark.line + 1 if mark else 1
            print(f"::error file=content/{name}.yaml,line={line}::content/{name}.yaml can't be read near line {line}. "
                  f"This is usually indentation (lines in the same list need the same number of spaces) "
                  f"or a colon inside text - put that text in quotes.")
            ok = False
            continue
        (out / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str))
        print(f"Wrote site/data/{name}.json")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
