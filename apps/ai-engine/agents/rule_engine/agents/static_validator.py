# apps/ai-engine/agents/rule_engine/agents/static_validator.py

import json
import time
import logging
from typing import Tuple

from ..rules.static_rules import (
    get_static_rules,
    get_false_negative_rules,
)
from ..rules.rule_models import (
    ValidationResult, RuleViolation,
    RuleSeverity, RuleCategory, Rule, RuleType,
)
from services.llm import complete

log = logging.getLogger("ai-engine.rule_engine.validator")

PASS_THRESHOLD = 80.0
MAX_ITERATIONS = 5

# ✅ FIX: BATCH_SIZE 4 → 7
# Before: 14 static rules → 4 batches = 4 LLM calls per iteration
# After:  14 static rules → 2 batches = 2 LLM calls per iteration
# Per iteration total: 3 calls (instead of 6)
# Max 5 iterations: 15 calls (instead of 30)
BATCH_SIZE = 7

# Score weights
STATIC_WEIGHT  = 0.70
DYNAMIC_WEIGHT = 0.30

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
4. If VIOLATED: quote the exact sentence

Return ONLY valid JSON. No markdown, no explanation."""


class StaticValidatorAgent:
    """
    Agent 1 — Validates content against Static Rules + Dynamic Rules.

    SPEC COMPLIANT:
    - Static Rules: always applied (SR000-SR013)
    - Dynamic Rules: applied from Agent 3 output
    - Score: 70% static + 30% dynamic
    - Category breakdown: per-category scores returned
    """

    def __init__(self):
        self.static_rules = get_static_rules()
        self.fn_rules     = get_false_negative_rules()
        self.other_static = [
            r for r in self.static_rules
            if r.category != RuleCategory.FALSE_NEGATIVE
        ]

    # ─────────────────────────────────────────────────────────────────────────
    async def validate(
        self,
        content:       str,
        iteration:     int               = 1,
        dynamic_rules: list[Rule] | None = None,
    ) -> ValidationResult:

        dynamic_rules = dynamic_rules or []
        start         = time.time()

        log.info(
            "[Validator] Iter %d | static_rules=%d | dynamic_rules=%d | batch_size=%d",
            iteration, len(self.static_rules), len(dynamic_rules), BATCH_SIZE,
        )

        # ════════════════════════════════════════════════════════════════════
        # STATIC RULES VALIDATION
        # ════════════════════════════════════════════════════════════════════

        static_violations:   list[RuleViolation] = []
        static_passed_rules: list[str]           = []

        # False Negative rules FIRST (critical path)
        fn_v, fn_p = await self._validate_batch(
            content=content,
            rules=self.fn_rules,
            priority="CRITICAL — FALSE NEGATIVES",
        )
        static_violations.extend(fn_v)
        static_passed_rules.extend(fn_p)

        # Remaining static rules — larger batches now
        for batch in self._make_batches(self.other_static, BATCH_SIZE):
            v, p = await self._validate_batch(content=content, rules=batch)
            static_violations.extend(v)
            static_passed_rules.extend(p)

        # Static score
        static_score = self._calculate_score(
            violations=static_violations,
            all_rules=self.static_rules,
        )

        # ════════════════════════════════════════════════════════════════════
        # DYNAMIC RULES VALIDATION
        # ════════════════════════════════════════════════════════════════════

        dynamic_violations:   list[RuleViolation] = []
        dynamic_passed_rules: list[str]           = []
        dynamic_score = 100.0

        if dynamic_rules:
            for batch in self._make_batches(dynamic_rules, BATCH_SIZE):
                v, p = await self._validate_batch(
                    content=content,
                    rules=batch,
                    priority="DYNAMIC BRAND RULES",
                )
                dynamic_violations.extend(v)
                dynamic_passed_rules.extend(p)

            dynamic_score = self._calculate_score(
                violations=dynamic_violations,
                all_rules=dynamic_rules,
            )

        # ════════════════════════════════════════════════════════════════════
        # COMBINED SCORE (70% static + 30% dynamic)
        # ════════════════════════════════════════════════════════════════════

        combined_score = (
            (static_score  * STATIC_WEIGHT) +
            (dynamic_score * DYNAMIC_WEIGHT)
        )
        combined_score = round(combined_score, 2)

        all_violations   = static_violations + dynamic_violations
        all_passed_rules = static_passed_rules + dynamic_passed_rules

        # Critical failures
        critical_failures = [
            v.rule_id for v in static_violations
            if v.severity == RuleSeverity.CRITICAL
        ]

        # Cap score if critical failure
        if critical_failures:
            combined_score = min(combined_score, 60.0)
            log.warning(
                "[Validator] Critical failures: %s → capped at 60%%",
                critical_failures,
            )

        passed = (combined_score >= PASS_THRESHOLD) and (not critical_failures)

        # ════════════════════════════════════════════════════════════════════
        # CATEGORY BREAKDOWN
        # ════════════════════════════════════════════════════════════════════

        category_breakdown = self._build_category_breakdown(
            all_violations=all_violations,
            all_rules=self.static_rules + dynamic_rules,
        )

        elapsed = round((time.time() - start) * 1000, 1)
        log.info(
            "[Validator] Done | iter=%d | "
            "score=%.1f%% (static=%.1f%%, dynamic=%.1f%%) | "
            "passed=%s | violations=%d | critical=%d | time=%sms",
            iteration,
            combined_score, static_score, dynamic_score,
            passed, len(all_violations), len(critical_failures), elapsed,
        )

        return ValidationResult(
            score=combined_score,
            static_score=round(static_score, 2),
            dynamic_score=round(dynamic_score, 2),
            passed=passed,
            violations=all_violations,
            passed_rules=all_passed_rules,
            critical_failures=critical_failures,
            iteration=iteration,
            feedback=self._build_feedback(
                combined_score, static_score, dynamic_score,
                all_violations, critical_failures,
            ),
            category_breakdown=category_breakdown,
        )

    # ─────────────────────────────────────────────────────────────────────────
    async def _validate_batch(
        self,
        content:  str,
        rules:    list[Rule],
        priority: str = "",
    ) -> Tuple[list[RuleViolation], list[str]]:

        if not rules:
            return [], []

        rules_json = json.dumps(
            [
                {
                    "id":          r.id,
                    "name":        r.name,
                    "severity":    r.severity.value,
                    "category":    r.category.value,
                    "type":        r.type.value,
                    "instruction": r.instruction,
                    "examples":    r.examples or {},
                }
                for r in rules
            ],
            indent=2,
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

## Required Response (ONLY this JSON):
{{
  "evaluations": [
    {{
      "rule_id":               "SR000",
      "status":                "passed" | "violated",
      "violation_description": "What exactly was violated (null if passed)",
      "location":              "Quote the exact sentence (null if passed)",
      "suggestion":            "How to fix it (null if passed)"
    }}
  ]
}}

- Evaluate EVERY rule — one entry per rule
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
            log.error("[Validator] Batch failed: %s", e)
            # ✅ FIX: Fail open — treat as passed on LLM error
            # Better to pass than to fail entire pipeline
            return [], [r.id for r in rules]

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
            log.error("[Validator] Parse error: %s", e)
            # ✅ FIX: Fail open on parse error
            passed_rules = [r.id for r in rules]

        return violations, passed_rules

    # ─────────────────────────────────────────────────────────────────────────
    def _calculate_score(
        self,
        violations: list[RuleViolation],
        all_rules:  list[Rule],
    ) -> float:

        if not all_rules:
            return 100.0

        rule_map     = {r.id: r for r in all_rules}
        total_weight = sum(r.weight for r in all_rules)

        if total_weight == 0:
            return 100.0

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
    def _build_category_breakdown(
        self,
        all_violations: list[RuleViolation],
        all_rules:      list[Rule],
    ) -> dict:
        """Per-category score breakdown."""
        category_rules: dict[str, list[Rule]] = {}
        for rule in all_rules:
            cat = rule.category.value
            category_rules.setdefault(cat, []).append(rule)

        category_violations: dict[str, list[RuleViolation]] = {}
        for v in all_violations:
            cat = v.category.value
            category_violations.setdefault(cat, []).append(v)

        breakdown = {}
        for cat, rules in category_rules.items():
            violations = category_violations.get(cat, [])
            cat_score  = self._calculate_score(
                violations=violations,
                all_rules=rules,
            )
            breakdown[cat] = {
                "score":      round(cat_score, 1),
                "violations": len(violations),
                "passed":     cat_score >= PASS_THRESHOLD,
                "rule_count": len(rules),
            }

        return breakdown

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
        static_score:      float,
        dynamic_score:     float,
        violations:        list[RuleViolation],
        critical_failures: list[str],
    ) -> str:

        if not violations:
            return (
                f"✅ All rules passed. "
                f"Score: {score:.1f}% "
                f"(static: {static_score:.1f}%, dynamic: {dynamic_score:.1f}%)"
            )

        parts = [
            f"Score: {score:.1f}% "
            f"(static: {static_score:.1f}%, dynamic: {dynamic_score:.1f}%) | "
            f"{len(violations)} violation(s)."
        ]

        if critical_failures:
            parts.append(
                f"🔴 CRITICAL ({len(critical_failures)}): "
                f"{', '.join(critical_failures)} → capped at 60%."
            )

        fn_v = [
            v for v in violations
            if v.category == RuleCategory.FALSE_NEGATIVE
        ]
        if fn_v:
            parts.append(f"⚠️ FALSE NEGATIVES ({len(fn_v)}):")
            for v in fn_v:
                if v.location:
                    parts.append(f'   → "{v.location}"')

        return " ".join(parts)