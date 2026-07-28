# apps/ai-engine/agents/rule_engine/agents/regeneration_agent.py

import logging
from ..rules.rule_models import (
    ValidationResult, RuleViolation, RuleSeverity, RuleCategory,
)
from services.llm import complete

log = logging.getLogger("ai-engine.rule_engine.regeneration")

# ── SURGICAL REWRITE INSTRUCTIONS ──────────────────────────────────────────────
REGEN_SYSTEM = """You are a "Surgical Content Editor". 
Your job is to fix specific rule violations in a text WITHOUT rewriting the entire article.

SURGICAL REWRITE RULES:
1. You will receive the original content and a list of specific violations.
2. Locate ONLY the sentences that caused the violations.
3. Fix those specific sentences based on the instructions.
4. COPY the rest of the text EXACTLY as it is.
5. Return the full content. Do not truncate or summarize.

FALSE NEGATIVE FIXING (CRITICAL):
Convert EVERY "not X, it's Y" construction into a DIRECT POSITIVE assertion.
  BAD:  "It's not a cost, it's an investment."
  GOOD: "It pays for itself within a quarter."
  
ABSOLUTE RULE: Never use 'not just', 'not merely', 'not only', 'more than just', 'isn't just', 'not about X it's about Y' in your rewrite.

Return ONLY the full updated content. No commentary, no markdown labels."""


class RegenerationAgent:
    """
    Agent 2 — Surgical Content Editor.
    Fixes specific rule violations without rewriting untouched content.
    """

    def __init__(self):
        pass

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
            "[Regen] Iteration %d | fixing %d violations "
            "(%d false negatives) surgically.",
            iteration, len(validation_result.violations), len(fn_violations)
        )

        fix_block     = self._build_fix_block(fn_violations, other_violations)
        content_words = len(content.split())
        max_tok       = min(int(content_words * 1.5) + 500, 5000)

        prompt = f"""Apply surgical fixes to the content below.

## Violations to Fix:
{fix_block}

## Original Content:
\"\"\"
{content}
\"\"\"

## Instructions:
1. Find the exact locations mentioned in the "Violations to Fix".
2. Rewrite ONLY those specific sentences.
3. Keep 99% of the original content completely untouched.
4. Output the full, complete article with just those surgical fixes applied.

Return ONLY the updated content."""

        try:
            result, _ = await complete(
                system=REGEN_SYSTEM,
                user=prompt,
                temperature=0.3,
                max_tokens=max_tok,
            )
            improved = result.strip()
            
            # Failsafe: Revert to original if LLM accidentally truncated content
            if len(improved) < len(content) * 0.5:
                log.error("[Regen] LLM truncated the content! Reverting to original.")
                return content
                
            log.info(
                "[Regen] Iteration %d done | chars: %d → %d",
                iteration, len(content), len(improved)
            )
            return improved

        except Exception as e:
            log.error("[Regen] Failed at iteration %d: %s", iteration, e)
            return content

    def _build_fix_block(
        self,
        fn_violations:    list[RuleViolation],
        other_violations: list[RuleViolation],
    ) -> str:
        lines = []

        if fn_violations:
            lines.append("### 🔴 CRITICAL — FALSE NEGATIVES (Fix these FIRST):")
            for i, v in enumerate(fn_violations, 1):
                lines.append(f"{i}. Rule: {v.rule_name}")
                if v.location:
                    lines.append(f"   Locate this sentence: \"{v.location}\"")
                lines.append(f"   Fix Instruction: {v.suggestion}")
                lines.append("")

        if other_violations:
            lines.append("### 🟠 OTHER VIOLATIONS:")
            for i, v in enumerate(other_violations, 1):
                lines.append(f"{i}. Rule: {v.rule_name}")
                if v.location:
                    lines.append(f"   Locate this sentence: \"{v.location}\"")
                lines.append(f"   Fix Instruction: {v.suggestion}")
                lines.append("")

        return "\n".join(lines)
