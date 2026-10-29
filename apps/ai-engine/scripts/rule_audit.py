"""Audit whether each writing rule is actually enforced.

A rule that exists in a list is not a rule the product follows. This answers,
for every rule the engine carries, three separate questions:

  1. DETECTED   Does the validator raise it on text that breaks it, and stay
                quiet on clean text?  (deterministic rules: offline, free;
                LLM-judged rules: --live, asks the real model)
  2. ACTED ON   What does a violation cost?  BLOCKS the draft, REWRITES it (earns
                a polish pass even when the draft passes), or is REPORT-ONLY
                (moves the score by a rounding error and changes nothing).
  3. OBEYED     --rewrite FILE runs the whole rule engine, with the real model,
                on a draft and shows per rule whether the rewrite removed the
                problem, left it, or introduced it.

    python scripts/rule_audit.py                    # 1 + 2, offline
    python scripts/rule_audit.py --check            # same, exit 1 on any gap (CI)
    python scripts/rule_audit.py --live             # also asks the model about SR000-SR016
    python scripts/rule_audit.py --text post.txt    # which rules a given post trips
    python scripts/rule_audit.py --rewrite post.txt # did the rewrite actually fix them
    python scripts/rule_audit.py --write            # save the report to docs/RULE_AUDIT.md
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # apps/ai-engine
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval" / "audit"))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

for _env in (ROOT / ".env", ROOT.parents[1] / ".env"):
    if _env.exists():
        load_dotenv(_env)
        break

from agents.rule_engine.agents import static_validator as sv  # noqa: E402
from agents.rule_engine.agents.static_validator import StaticValidatorAgent  # noqa: E402
from agents.rule_engine.orchestrator import POLISH_SEVERITIES  # noqa: E402
from agents.rule_engine.rules.tell_rules import RULE_ID_TO_TELL  # noqa: E402
from fixtures import CLEAN, LLM_FIXTURES, TELL_FIXTURES  # noqa: E402

REPORT = ROOT.parents[1] / "docs" / "RULE_AUDIT.md"
BLOCKS, REWRITES, REPORT_ONLY = "BLOCKS", "REWRITES", "REPORT-ONLY"


def consequence(agent: StaticValidatorAgent, rule) -> str:
    """What happens to a draft whose only problem is this one rule."""
    if rule.id in sv.GROUNDING_RULE_IDS:
        return BLOCKS
    violation = sv.RuleViolation(
        rule_id=rule.id, rule_name=rule.name, severity=rule.severity,
        category=rule.category, description="x", suggestion="x",
    )
    scored = agent._calculate_score([violation], agent.static_rules)
    combined = scored * sv.STATIC_WEIGHT + 100.0 * sv.DYNAMIC_WEIGHT
    if rule.severity == sv.RuleSeverity.CRITICAL:
        combined = min(combined, 72.0 if rule.category == sv.RuleCategory.FALSE_NEGATIVE else 78.0)
    if combined < sv.PASS_THRESHOLD:
        return BLOCKS
    return REWRITES if rule.severity in POLISH_SEVERITIES else REPORT_ONLY


def audit_deterministic(agent: StaticValidatorAgent) -> list[dict]:
    control, _, _ = agent._detect_tells(CLEAN)
    false_fires = {v.rule_id for v in control}
    rows = []
    for rule in agent.tell_rules:
        tell_id = RULE_ID_TO_TELL.get(rule.id, "")
        text = TELL_FIXTURES.get(tell_id)
        row = {
            "id": rule.id, "tell": tell_id, "name": rule.name, "kind": "code (regex/measure)",
            "severity": rule.severity.value, "fix_text": bool(rule.instruction.strip()),
            "consequence": consequence(agent, rule), "fixture": text is not None,
            "detected": None, "false_fire": rule.id in false_fires,
        }
        if text is not None:
            hits, _, _ = agent._detect_tells(text)
            row["detected"] = rule.id in {v.rule_id for v in hits}
        rows.append(row)
    return rows


async def audit_llm(agent: StaticValidatorAgent, live: bool) -> list[dict]:
    rows = []
    for rule in agent.static_rules:
        if rule.deterministic:
            continue
        fx = LLM_FIXTURES.get(rule.id)
        backup = rule.id in {"SR000", "SR001"}
        row = {
            "id": rule.id, "tell": "", "name": rule.name,
            "kind": "LLM-judged" + (" + regex backstop" if backup else ""),
            "severity": rule.severity.value, "fix_text": bool(rule.instruction.strip()),
            "consequence": consequence(agent, rule), "fixture": fx is not None,
            "detected": None, "false_fire": None,
        }
        if live and fx:
            agent._unverified = set()
            bad, _ = await agent._validate_batch(fx["violates"], [rule])
            ok, _ = await agent._validate_batch(fx["clean"], [rule])
            if agent._unverified:
                row["detected"] = "unverified"
            else:
                row["detected"] = rule.id in {v.rule_id for v in bad}
                row["false_fire"] = rule.id in {v.rule_id for v in ok}
        rows.append(row)
    return rows


def verdict(row: dict) -> str:
    if row["detected"] is None:
        return "not proven" if row["kind"].startswith("LLM") else "NO FIXTURE"
    if row["detected"] == "unverified":
        return "provider down"
    if not row["detected"]:
        return "MISSED"
    if row["false_fire"]:
        return "FALSE ALARM"
    return "ok"


def print_table(rows: list[dict]) -> None:
    print(f"{'rule':6} {'kind':26} {'sev':8} {'on violation':13} {'if it fires':12} name")
    print("-" * 100)
    for r in rows:
        print(f"{r['id']:6} {r['kind'][:26]:26} {r['severity']:8} {verdict(r):13} {r['consequence']:12} {r['name']}")


def summarise(rows: list[dict]) -> tuple[dict, list[str]]:
    problems = []
    for r in rows:
        v = verdict(r)
        if v in ("MISSED", "NO FIXTURE", "FALSE ALARM"):
            problems.append(f"{r['id']} {r['name']}: {v}")
        if not r["fix_text"]:
            problems.append(f"{r['id']} {r['name']}: no fix text for the rewriter")
    tiers = {t: [r["id"] for r in rows if r["consequence"] == t] for t in (BLOCKS, REWRITES, REPORT_ONLY)}
    return tiers, problems


def markdown(rows: list[dict], tiers: dict, problems: list[str], live: bool) -> str:
    out = ["# Rule enforcement audit", "",
           "Generated by `apps/ai-engine/scripts/rule_audit.py`. Regenerate with `--write`"
           + (" `--live`." if live else ".") + "", "",
           "**On violation** says whether the validator raises the rule on text that breaks it "
           "(`not proven` = LLM-judged and not run with `--live`). **If it fires** says what a hit "
           "changes: `BLOCKS` fails the draft, `REWRITES` earns a polish pass even on a passing draft, "
           "`REPORT-ONLY` is logged and scored but changes nothing on its own.", "",
           "| Rule | Name | Kind | Severity | On violation | If it fires |", "|---|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['id']} | {r['name']} | {r['kind']} | {r['severity']} | {verdict(r)} | {r['consequence']} |")
    out += ["", "## Summary", ""]
    for tier, ids in tiers.items():
        out.append(f"- **{tier}** ({len(ids)}): {', '.join(ids) or 'none'}")
    out += ["", "## Gaps", ""] + ([f"- {p}" for p in problems] or ["- none"])
    out += ["", "Report-only rules still count toward the density cap: a piece with 2.0 or more "
            "effective tells per 100 words is capped below the pass mark and rewritten."]
    return "\n".join(out) + "\n"


def audit_text(agent: StaticValidatorAgent, text: str) -> dict[str, list[str]]:
    violations, _, density = agent._detect_tells(text)
    found: dict[str, list[str]] = {}
    for v in violations:
        found.setdefault(v.rule_id, []).append(v.location or "")
    found["_density"] = [f"{density:.2f}"]
    return found


def print_text_audit(agent: StaticValidatorAgent, text: str) -> None:
    found = audit_text(agent, text)
    density = float(found.pop("_density")[0])
    by_id = {r.id: r for r in agent.tell_rules}
    print(f"{len(found)} rule(s) tripped, density {density}/100 words "
          f"({'at or over' if density >= sv.TELL_DENSITY_FAIL else 'under'} the {sv.TELL_DENSITY_FAIL} cap)\n")
    for rid, quotes in sorted(found.items()):
        rule = by_id[rid]
        print(f"{rid} {rule.name}  [{rule.severity.value}, {consequence(agent, rule)}]")
        for q in quotes[:3]:
            print(f"    \"{q[:140]}\"")
    clear = [r.id for r in agent.tell_rules if r.id not in found]
    print(f"\nnot tripped: {', '.join(clear)}")


async def rewrite_audit(agent: StaticValidatorAgent, text: str) -> None:
    from agents.rule_engine.orchestrator import RuleEngineOrchestrator

    before = audit_text(agent, text)
    before.pop("_density")
    result = await RuleEngineOrchestrator().process(content=text, user_prompt="", brand_data={})
    after = audit_text(agent, result.final_content)
    density_after = after.pop("_density")[0]
    by_id = {r.id: r for r in agent.tell_rules}
    print(f"engine: score {result.final_score}, {result.total_iterations} iteration(s), "
          f"density after {density_after}/100 words\n")
    print(f"{'rule':6} {'before':>6} {'after':>6}  outcome        name")
    print("-" * 80)
    for rid in sorted(set(before) | set(after)):
        b, a = len(before.get(rid, [])), len(after.get(rid, []))
        outcome = "FIXED" if b and not a else "STILL THERE" if b and a else "INTRODUCED"
        print(f"{rid:6} {b:>6} {a:>6}  {outcome:14} {by_id[rid].name}")
    print("\n--- rewritten text ---\n" + result.final_content)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if any rule is missed, unfixtured or false-alarms")
    ap.add_argument("--live", action="store_true", help="ask the real model about the LLM-judged rules")
    ap.add_argument("--write", action="store_true", help=f"write the report to {REPORT.relative_to(ROOT.parents[1])}")
    ap.add_argument("--text", metavar="FILE", help="which rules this post trips")
    ap.add_argument("--rewrite", metavar="FILE", help="run the whole engine on this post and show what it fixed")
    args = ap.parse_args()

    agent = StaticValidatorAgent()

    if args.text:
        print_text_audit(agent, Path(args.text).read_text(encoding="utf-8"))
        return 0
    if args.rewrite:
        asyncio.run(rewrite_audit(agent, Path(args.rewrite).read_text(encoding="utf-8")))
        return 0

    rows = audit_deterministic(agent) + asyncio.run(audit_llm(agent, args.live))
    rows.sort(key=lambda r: r["id"])
    tiers, problems = summarise(rows)
    print_table(rows)
    print()
    for tier, ids in tiers.items():
        print(f"{tier:12} {len(ids):2}  {', '.join(ids)}")
    print("\ngaps:" + ("\n  " + "\n  ".join(problems) if problems else " none"))
    if args.write:
        REPORT.write_text(markdown(rows, tiers, problems, args.live), encoding="utf-8")
        print(f"\nwrote {REPORT}")
    return 1 if args.check and problems else 0


if __name__ == "__main__":
    sys.exit(main())
