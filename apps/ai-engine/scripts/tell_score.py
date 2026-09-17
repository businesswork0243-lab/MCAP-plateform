#!/usr/bin/env python
"""Measure AI writing tells across a corpus, and fail when they rise.

We could not previously measure how AI-sounding our output was, which made
every claim of improvement unfalsifiable. This is that measurement.

    python scripts/tell_score.py eval/corpus                  # report
    python scripts/tell_score.py eval/corpus --save-baseline  # freeze
    python scripts/tell_score.py eval/corpus --check          # CI gate

Reads .txt and .md files. A leading "---" front-matter block is ignored, so a
sample can carry notes about where it came from.

Generated output and human reference posts are scored APART, and only the
generated side moves the baseline or the gate. This matters more than it
looks: human writing carries fewer tells, so pooling the two would drag the
average down and let a real regression in our own output pass the check. The
act of filling in the human corpus would have quietly disarmed CI.

The human side answers the other question — not "are we getting worse" but
"are we getting closer to how these people actually write".
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
GENERATED_DIR = "generated"
HUMAN_DIR = "human"

# Density is noisy on short pieces, so allow a little slack before failing.
TOLERANCE = 0.15

# Patterns that a person does not produce by accident. A dash or a triad in a
# "human" sample means nothing; "Great question." or "as of my last update"
# means the sample came out of a chatbot and would poison the reference it is
# supposed to provide.
CHATBOT_RESIDUE = ("TELL22", "TELL23")


def read_sample(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S).strip()


def _files_under(root: Path) -> list[Path]:
    return sorted(
        p for p in root.rglob("*")
        if p.suffix in (".txt", ".md") and p.name.lower() != "readme.md"
    )


def score_files(files: list[Path], relative_to: Path) -> dict | None:
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
            "file": str(path.relative_to(relative_to)).replace("\\", "/"),
            "words": report["words"],
            "effective": report["effective_count"],
            "strong": report["strong_count"],
            "weak": report["weak_count"],
            "per_100_words": report["per_100_words"],
            "patterns": sorted(report["counts"]),
            "residue": sorted(
                pid for pid in report["counts"] if pid in CHATBOT_RESIDUE
            ),
        })

    if not per_file:
        return None

    density = round(total_effective / total_words * 100, 3) if total_words else 0.0
    return {
        "files": len(per_file),
        "words": total_words,
        "effective_tells": total_effective,
        "tells_per_100_words": density,
        "by_pattern": dict(sorted(pattern_totals.items())),
        "per_file": per_file,
    }


def score_corpus(corpus: Path) -> dict:
    """The generated side — what the baseline and the gate are built on."""
    generated_dir = corpus / GENERATED_DIR
    root = generated_dir if generated_dir.is_dir() else corpus

    # Scoring an ad-hoc folder of pasted text is a supported use, so a corpus
    # without the generated/ layout falls back to everything under it.
    files = _files_under(root)
    if root is corpus and (corpus / HUMAN_DIR).is_dir():
        files = [f for f in files if HUMAN_DIR not in f.parts]

    result = score_files(files, corpus)
    if result is None:
        raise SystemExit(f"No .txt or .md samples found under {root}")
    return result


def score_human(corpus: Path) -> dict | None:
    """The reference side — posts written by people. Never gates anything."""
    human_dir = corpus / HUMAN_DIR
    if not human_dir.is_dir():
        return None
    return score_files(_files_under(human_dir), corpus)


def _residue_warnings(result: dict | None) -> list[str]:
    if not result:
        return []
    return [row["file"] for row in result["per_file"] if row["residue"]]


def print_report(
    result: dict,
    baseline: dict | None,
    human: dict | None = None,
) -> None:
    print(f"\n{'file':<44} {'words':>6} {'tells':>6} {'/100w':>7}")
    print("-" * 66)
    for row in result["per_file"]:
        print(f"{row['file']:<44} {row['words']:>6} "
              f"{row['effective']:>6} {row['per_100_words']:>7.2f}")
    print("-" * 66)
    print(f"{'TOTAL (generated)':<44} {result['words']:>6} "
          f"{result['effective_tells']:>6} {result['tells_per_100_words']:>7.2f}")

    if result["by_pattern"]:
        print("\nmost frequent patterns")
        ranked = sorted(result["by_pattern"].items(), key=lambda kv: -kv[1])
        for pid, n in ranked[:8]:
            print(f"  {pid}  {n}")

    # ── Direction ─────────────────────────────────────────────────────────────
    if human:
        print(f"\n{'human reference':<44} {'words':>6} {'tells':>6} {'/100w':>7}")
        print("-" * 66)
        for row in human["per_file"]:
            print(f"{row['file']:<44} {row['words']:>6} "
                  f"{row['effective']:>6} {row['per_100_words']:>7.2f}")
        print("-" * 66)
        print(f"{'TOTAL (human)':<44} {human['words']:>6} "
              f"{human['effective_tells']:>6} {human['tells_per_100_words']:>7.2f}")

        gap = round(result["tells_per_100_words"] - human["tells_per_100_words"], 2)
        if gap > 0:
            print(f"\ngap: we carry {gap} more tells per 100 words than these people do")
        elif gap < 0:
            print(f"\ngap: we carry {abs(gap)} fewer tells per 100 words than this "
                  "reference — check the reference is representative")
        else:
            print("\ngap: none")

        if human["files"] < 10:
            print(f"note: {human['files']} human sample(s). The plan asks for 10-15 "
                  "before the direction figure means much.")

        for name in _residue_warnings(human):
            print(f"WARNING: {name} contains chatbot residue. A sample that came "
                  "out of a model is not a human reference — remove it.")
    else:
        print("\nno human reference: this measures whether we are getting worse, "
              "not whether we are getting closer to how people write.")
        print("see eval/corpus/human/README.md")

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
    human = score_human(args.corpus)

    baseline_path = args.corpus / BASELINE_NAME
    baseline = (
        json.loads(baseline_path.read_text(encoding="utf-8"))
        if baseline_path.exists() else None
    )

    if args.json:
        print(json.dumps({"generated": result, "human": human}, indent=2))
    else:
        print_report(result, baseline, human)

    if args.save_baseline:
        # The human side is recorded for context but deliberately kept out of
        # the figure --check reads, so adding reference posts can never move
        # the gate.
        payload = dict(result)
        if human:
            payload["human_reference"] = {
                "files": human["files"],
                "words": human["words"],
                "tells_per_100_words": human["tells_per_100_words"],
            }
        baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"\nbaseline written to {baseline_path}")
        return 0

    if args.check:
        if not baseline:
            print("\nNo baseline to check against. Run --save-baseline first.")
            return 1

        residue = _residue_warnings(human)
        if residue:
            print(f"\nFAIL: human reference contains chatbot residue: "
                  f"{', '.join(residue)}")
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
