#!/usr/bin/env python
"""Measure AI writing tells across a corpus, and fail when they rise.

We could not previously measure how AI-sounding our output was, which made
every claim of improvement unfalsifiable. This is that measurement.

    python scripts/tell_score.py eval/corpus                  # report
    python scripts/tell_score.py eval/corpus --save-baseline  # freeze
    python scripts/tell_score.py eval/corpus --check          # CI gate

Reads .txt and .md files. A leading "---" front-matter block is ignored, so a
sample can carry notes about where it came from.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from services.tells import tell_report  # noqa: E402

BASELINE_NAME = "baseline.json"
# Density is noisy on short pieces, so allow a little slack before failing.
TOLERANCE = 0.15


def read_sample(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S).strip()


def score_corpus(corpus: Path) -> dict:
    files = sorted(
        p for p in corpus.rglob("*")
        if p.suffix in (".txt", ".md") and p.name.lower() != "readme.md"
    )
    if not files:
        raise SystemExit(f"No .txt or .md samples found under {corpus}")

    per_file, total_effective, total_words = [], 0, 0
    pattern_totals: dict[str, int] = {}

    for path in files:
        text = read_sample(path)
        if not text:
            continue
        report = tell_report(text)
        total_effective += report["effective_count"]
        total_words += report["words"]
        for pid, n in report["counts"].items():
            pattern_totals[pid] = pattern_totals.get(pid, 0) + n

        per_file.append({
            "file": str(path.relative_to(corpus)).replace("\\", "/"),
            "words": report["words"],
            "effective": report["effective_count"],
            "strong": report["strong_count"],
            "weak": report["weak_count"],
            "per_100_words": report["per_100_words"],
            "patterns": sorted(report["counts"]),
        })

    density = round(total_effective / total_words * 100, 3) if total_words else 0.0
    return {
        "files": len(per_file),
        "words": total_words,
        "effective_tells": total_effective,
        "tells_per_100_words": density,
        "by_pattern": dict(sorted(pattern_totals.items())),
        "per_file": per_file,
    }


def print_report(result: dict, baseline: dict | None) -> None:
    print(f"\n{'file':<44} {'words':>6} {'tells':>6} {'/100w':>7}")
    print("-" * 66)
    for row in result["per_file"]:
        print(f"{row['file']:<44} {row['words']:>6} "
              f"{row['effective']:>6} {row['per_100_words']:>7.2f}")
    print("-" * 66)
    print(f"{'TOTAL':<44} {result['words']:>6} "
          f"{result['effective_tells']:>6} {result['tells_per_100_words']:>7.2f}")

    if result["by_pattern"]:
        print("\nmost frequent patterns")
        ranked = sorted(result["by_pattern"].items(), key=lambda kv: -kv[1])
        for pid, n in ranked[:8]:
            print(f"  {pid}  {n}")

    if baseline:
        before = baseline["tells_per_100_words"]
        after = result["tells_per_100_words"]
        arrow = "down" if after < before else ("up" if after > before else "unchanged")
        print(f"\nbaseline {before:.2f} -> {after:.2f} per 100 words ({arrow})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", type=Path)
    ap.add_argument("--save-baseline", action="store_true",
                    help="write the current numbers as the reference")
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if density rose beyond tolerance")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    result = score_corpus(args.corpus)
    baseline_path = args.corpus / BASELINE_NAME
    baseline = (
        json.loads(baseline_path.read_text(encoding="utf-8"))
        if baseline_path.exists() else None
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_report(result, baseline)

    if args.save_baseline:
        baseline_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"\nbaseline written to {baseline_path}")
        return 0

    if args.check:
        if not baseline:
            print("\nNo baseline to check against. Run --save-baseline first.")
            return 1
        before = baseline["tells_per_100_words"]
        after = result["tells_per_100_words"]
        if after > before + TOLERANCE:
            print(f"\nFAIL: tell density rose {before:.2f} -> {after:.2f} "
                  f"(tolerance {TOLERANCE})")
            return 1
        print(f"\nOK: {after:.2f} per 100 words, baseline {before:.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
