# apps/ai-engine/agents/rule_engine/agents/regeneration_agent.py

import logging
from agents.rule_engine.rules.rule_models import (
    ValidationResult, RuleViolation, RuleSeverity, RuleCategory,
)
from services.llm import complete

log = logging.getLogger("ai-engine.rule_engine.regeneration")

REGEN_SYSTEM = """You are an expert content editor.
Your speciality: eliminating FALSE NEGATIVES and fixing AI writing patterns.

FALSE NEGATIVE FIXING — your #1 priority:
Convert EVERY "not X, it's Y" construction into a DIRECT POSITIVE assertion.

CONVERSION RULES:
  BAD:  "Blockchain isn't just about crypto, it's about trust."
  GOOD: "Blockchain builds trust through cryptography."

  BAD:  "Not only does it scale, but it also secures."
  GOOD: "It scales and secures simultaneously."

  BAD:  "This is more than just a feature."
  GOOD: "This feature drives the entire strategy."

  BAD:  "It's not merely a tool, it's a mindset."
  GOOD: "It requires a fundamental mindset shift."

  BAD:  "It's not a cost, it's an investment."
  GOOD: "It pays for itself within a quarter."

ABSOLUTE RULE: Never use these in your rewrite:
  'not just', 'not merely', 'not only', 'more than just',
  'isn't just', 'not about X it's about Y', 'less about X more about Y'

Return ONLY the fixed content. No commentary, no labels, no explanation."""


class RegenerationAgent:
    """
    Agent 2 — Rewrites content to fix all Static Rule violations.
    Special focus on false negative elimination.
    """

    def __init__(self):
        pass

    # ─────────────────────────────────────────────────────────────────────────
    async def regenerate(
        self,
        content:           str,
        validation_result: ValidationResult,
        dynamic_context:   dict | None = None,
        iteration:         int         = 1,
    ) -> str:

        fn_violations = [
            v for v in validation_result.violations
            if v.category == RuleCategory.FALSE_NEGATIVE
        ]
        other_violations = [
            v for v in validation_result.violations
            if v.category != RuleCategory.FALSE_NEGATIVE
        ]

        log.info(
            "[Regen] Iteration %d | total_violations=%d "
            "(false_negatives=%d, others=%d)",
            iteration,
            len(validation_result.violations),
            len(fn_violations),
            len(other_violations),
        )

        fix_block     = self._build_fix_block(fn_violations, other_violations)
        context_block = self._build_context_block(dynamic_context)
        content_words = len(content.split())
        max_tok       = min(int(content_words * 1.5) + 500, 5000)

        prompt = f"""Fix ALL violations in the content below.

## Current Score: {validation_result.score:.1f}% (Target: ≥80%)
## Iteration: {iteration}

## Violations to Fix:
{fix_block}
{context_block}

## Content to Fix:
\"\"\"
{content}
\"\"\"

## Rewriting Rules:
1. Fix EVERY violation listed — none can remain
2. FALSE NEGATIVES → convert to direct positive assertions ONLY
3. Keep ALL facts, statistics, names, and data exactly as they are
4. Do NOT reduce content length by more than 10%
5. Preserve the overall structure (headings, sections, key points)
6. Make the result feel genuinely human-written

Return ONLY the fixed content. No explanation, no labels."""

        try:
            result, _ = await complete(
                system=REGEN_SYSTEM,
                user=prompt,
                temperature=0.65,
                max_tokens=max_tok,
            )
            improved = result.strip()
            log.info(
                "[Regen] Iteration %d done | chars: %d → %d",
                iteration, len(content), len(improved)
            )
            return improved

        except Exception as e:
            log.error("[Regen] Failed at iteration %d: %s", iteration, e)
            return content

    # ─────────────────────────────────────────────────────────────────────────
    def _build_fix_block(
        self,
        fn_violations:    list[RuleViolation],
        other_violations: list[RuleViolation],
    ) -> str:
        lines = []

        if fn_violations:
            lines.append(
                "### 🔴 CRITICAL — FALSE NEGATIVES (fix these first):\n"
                "Convert EVERY instance to a direct positive assertion.\n"
                "Do NOT use 'not just', 'not merely', 'more than just' anywhere.\n"
            )
            for i, v in enumerate(fn_violations, 1):
                lines.append(f"{i}. [{v.rule_id}] {v.rule_name}")
                lines.append(f"   Problem:  {v.description}")
                if v.location:
                    lines.append(f"   Found:    \"{v.location}\"")
                lines.append(f"   Fix:      {v.suggestion}")
                lines.append("")

        if other_violations:
            severity_order = {
                RuleSeverity.CRITICAL: 0,
                RuleSeverity.HIGH:     1,
                RuleSeverity.MEDIUM:   2,
                RuleSeverity.LOW:      3,
            }
            sorted_others = sorted(
                other_violations,
                key=lambda v: severity_order.get(v.severity, 9),
            )

            lines.append("### 🟠 OTHER VIOLATIONS:\n")
            for i, v in enumerate(sorted_others, 1):
                badge = {
                    RuleSeverity.CRITICAL: "🔴",
                    RuleSeverity.HIGH:     "🟠",
                    RuleSeverity.MEDIUM:   "🟡",
                    RuleSeverity.LOW:      "🟢",
                }.get(v.severity, "⚪")

                lines.append(f"{i}. {badge} [{v.rule_id}] {v.rule_name}")
                lines.append(f"   Problem:  {v.description}")
                if v.location:
                    lines.append(f"   Found:    \"{v.location}\"")
                lines.append(f"   Fix:      {v.suggestion}")
                lines.append("")

        return (
            "\n".join(lines)
            if lines
            else "No specific violations — improve general quality and naturalness."
        )

    # ─────────────────────────────────────────────────────────────────────────
    def _build_context_block(self, ctx: dict | None) -> str:
        if not ctx:
            return ""

        lines = ["\n## Brand Context (maintain throughout rewrite):"]
        labels = {
            "brand_voice":     "Brand Voice",
            "tone":            "Tone",
            "target_audience": "Audience",
            "writing_style":   "Style",
            "platform":        "Platform",
            "campaign_goal":   "Goal",
        }
        for key, label in labels.items():
            if val := ctx.get(key):
                lines.append(f"- {label}: {val}")

        return "\n".join(lines)
