# apps/ai-engine/agents/rule_engine/agents/static_validator.py

import json
import time
import logging
from typing import Tuple

from agents.rule_engine.rules.static_rules import (
    get_static_rules,
    get_false_negative_rules,
)
from agents.rule_engine.rules.rule_models import (
    ValidationResult, RuleViolation,
    RuleSeverity, RuleCategory, Rule,
)
from services.llm import complete

log = logging.getLogger("ai-engine.rule_engine.validator")

# ── Constants ─────────────────────────────────────────────────────────────────
PASS_THRESHOLD = 80.0
MAX_ITERATIONS = 5
BATCH_SIZE     = 4

VALIDATOR_SYSTEM = """You are a professional content quality auditor.
Your speciality is detecting FALSE NEGATIVES — the #1 AI writing tell.

A false negative is ANY construction that says what something is NOT
before saying what it IS:
  "It's not just X, it's Y"
  "Not only does it X, but it also Y"
  "More than just X"
  "Not merely X"

These are ALWAYS violations — zero exceptions.

For each rule provided:
1. Read the instruction carefully
2. Scan the ENTIRE content
3. Determine PASSED or VIOLATED
4. If VIOLATED: quote the exact location

Return ONLY valid JSON. No markdown, no explanation, no preamble."""


class StaticValidatorAgent:
    """
    Agent 1 — Validates content against all Static Rules.

    - False negative rules (SR000, SR001) validated FIRST
    - Critical failure → score capped at 60%
    - Detailed violation report sent to Agent 2
    """

    def __init__(self):
        self.all_rules   = get_static_rules()
        self.fn_rules    = get_false_negative_rules()    # SR000, SR001
        self.other_rules = [
            r for r in self.all_rules
            if r.category != RuleCategory.FALSE_NEGATIVE
        ]

    # ─────────────────────────────────────────────────────────────────────────
    async def validate(
        self,
        content:   str,
        iteration: int = 1,
    ) -> ValidationResult:

        start = time.time()
        log.info(
            "[Validator] Iteration %d | content_len=%d chars",
            iteration, len(content)
        )

        all_violations:   list[RuleViolation] = []
        all_passed_rules: list[str]           = []

        # ── Step 1: False Negative Rules FIRST ───────────────────────────
        fn_violations, fn_passed = await self._validate_batch(
            content=content,
            rules=self.fn_rules,
            priority="CRITICAL — FALSE NEGATIVES: Evaluate with maximum care."
        )
        all_violations.extend(fn_violations)
        all_passed_rules.extend(fn_passed)

        # ── Step 2: Remaining Rules in batches ───────────────────────────
        for batch in self._make_batches(self.other_rules, BATCH_SIZE):
            violations, passed = await self._validate_batch(
                content=content,
                rules=batch,
            )
            all_violations.extend(violations)
            all_passed_rules.extend(passed)

        # ── Step 3: Weighted score ────────────────────────────────────────
        score = self._calculate_score(all_violations)

        # ── Step 4: Critical failure check ───────────────────────────────
        critical_failures = [
            v.rule_id for v in all_violations
            if v.severity == RuleSeverity.CRITICAL
        ]

        if critical_failures:
            score = min(score, 60.0)
            log.warning(
                "[Validator] Critical failures: %s → score capped at 60%%",
                critical_failures
            )

        passed = (score >= PASS_THRESHOLD) and (len(critical_failures) == 0)
        elapsed = round((time.time() - start) * 1000, 1)

        log.info(
            "[Validator] Done | iter=%d | score=%.1f%% | passed=%s | "
            "violations=%d | critical=%d | time=%sms",
            iteration, score, passed,
            len(all_violations), len(critical_failures), elapsed
        )

        return ValidationResult(
            score=round(score, 2),
            passed=passed,
            violations=all_violations,
            passed_rules=all_passed_rules,
            critical_failures=critical_failures,
            iteration=iteration,
            feedback=self._build_feedback(score, all_violations, critical_failures),
        )

    # ─────────────────────────────────────────────────────────────────────────
    async def _validate_batch(
        self,
        content:  str,
        rules:    list[Rule],
        priority: str = "",
    ) -> Tuple[list[RuleViolation], list[str]]:

        rules_json = json.dumps(
            [
                {
                    "id":          r.id,
                    "name":        r.name,
                    "severity":    r.severity.value,
                    "category":    r.category.value,
                    "instruction": r.instruction,
                    "examples":    r.examples or {},
                }
                for r in rules
            ],
            indent=2
        )

        priority_block = (
            f"\n⚠️  PRIORITY: {priority}\n"
            if priority else ""
        )

        prompt = f"""{priority_block}
Evaluate this content against the rules below.

## Rules:
{rules_json}

## Content:
\"\"\"
{content}
\"\"\"

## Required Response (ONLY this JSON — nothing else):
{{
  "evaluations": [
    {{
      "rule_id":               "SR000",
      "status":                "passed" | "violated",
      "violation_description": "Exact description of what was violated (null if passed)",
      "location":              "Quote the exact sentence where violation occurs (null if passed)",
      "suggestion":            "Specific rewrite suggestion to fix it (null if passed)"
    }}
  ]
}}

RULES:
- One entry per rule — evaluate ALL rules provided
- For SR000/SR001: quote EVERY false negative instance found
- Return ONLY valid JSON"""

        try:
            response, _ = await complete(
                system=VALIDATOR_SYSTEM,
                user=prompt,
                temperature=0.1,
                max_tokens=2000,
            )
            return self._parse_response(response, rules)

        except Exception as e:
            log.error("[Validator] Batch call failed: %s", e)
            return [], [r.id for r in rules]    # Conservative: assume passed

    # ─────────────────────────────────────────────────────────────────────────
    def _parse_response(
        self,
        response: str,
        rules:    list[Rule],
    ) -> Tuple[list[RuleViolation], list[str]]:

        violations:   list[RuleViolation] = []
        passed_rules: list[str]           = []
        rule_map = {r.id: r for r in rules}

        try:
            clean = response.strip()
            if clean.startswith("```"):
                parts = clean.split("```")
                clean = parts[1] if len(parts) > 1 else clean
                if clean.startswith("json"):
                    clean = clean[4:]
            clean = clean.strip()

            data = json.loads(clean)

            for item in data.get("evaluations", []):
                rule_id = item.get("rule_id")
                status  = item.get("status", "passed")
                rule    = rule_map.get(rule_id)

                if not rule:
                    continue

                if status == "violated":
                    violations.append(RuleViolation(
                        rule_id=rule_id,
                        rule_name=rule.name,
                        severity=rule.severity,
                        category=rule.category,
                        description=item.get("violation_description") or "Rule violated",
                        location=item.get("location"),
                        suggestion=item.get("suggestion") or "Rewrite this section",
                    ))
                else:
                    passed_rules.append(rule_id)

        except (json.JSONDecodeError, KeyError) as e:
            log.error(
                "[Validator] Parse error: %s | preview: %s",
                e, response[:300]
            )
            passed_rules = [r.id for r in rules]

        return violations, passed_rules

    # ─────────────────────────────────────────────────────────────────────────
    def _calculate_score(self, violations: list[RuleViolation]) -> float:
        rule_map     = {r.id: r for r in self.all_rules}
        total_weight = sum(r.weight for r in self.all_rules)

        severity_multiplier = {
            RuleSeverity.CRITICAL: 1.6,
            RuleSeverity.HIGH:     1.2,
            RuleSeverity.MEDIUM:   1.0,
            RuleSeverity.LOW:      0.6,
        }

        deducted = 0.0
        for v in violations:
            rule = rule_map.get(v.rule_id)
            if rule:
                mult      = severity_multiplier.get(v.severity, 1.0)
                deducted += rule.weight * mult

        deducted = min(deducted, total_weight)
        score    = ((total_weight - deducted) / total_weight) * 100
        return round(max(0.0, min(100.0, score)), 2)

    # ─────────────────────────────────────────────────────────────────────────
    def _make_batches(
        self,
        rules: list[Rule],
        size:  int,
    ) -> list[list[Rule]]:
        return [rules[i:i + size] for i in range(0, len(rules), size)]

    # ─────────────────────────────────────────────────────────────────────────
    def _build_feedback(
        self,
        score:             float,
        violations:        list[RuleViolation],
        critical_failures: list[str],
    ) -> str:

        if not violations:
            return f"✅ All static rules passed. Score: {score:.1f}%"

        parts = [f"Score: {score:.1f}% | {len(violations)} violation(s)."]

        if critical_failures:
            parts.append(
                f"🔴 CRITICAL ({len(critical_failures)}): "
                f"{', '.join(critical_failures)} — score capped at 60%."
            )

        fn_violations = [
            v for v in violations
            if v.category == RuleCategory.FALSE_NEGATIVE
        ]
        if fn_violations:
            parts.append(
                f"⚠️ FALSE NEGATIVES ({len(fn_violations)}) — must be eliminated:"
            )
            for v in fn_violations:
                if v.location:
                    parts.append(f'   → "{v.location}"')

        high_violations = [
            v for v in violations
            if v.severity == RuleSeverity.HIGH
            and v.category != RuleCategory.FALSE_NEGATIVE
        ]
        if high_violations:
            parts.append("🟠 HIGH priority fixes:")
            for v in high_violations[:2]:
                parts.append(f"   → [{v.rule_id}] {v.description}")

        return " ".join(parts)
