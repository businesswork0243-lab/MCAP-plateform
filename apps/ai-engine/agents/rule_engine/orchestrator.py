# apps/ai-engine/agents/rule_engine/orchestrator.py

import os
import time
import uuid
import logging
from datetime import datetime, timezone

from .agents.static_validator   import (
    StaticValidatorAgent,
    MAX_ITERATIONS,
    PASS_THRESHOLD,
)
from .agents.regeneration_agent import RegenerationAgent
from .agents.dynamic_rule_gen   import DynamicRuleGeneratorAgent
from .rules.rule_models         import (
    RuleEngineResult, ValidationResult, DynamicRuleSet, RuleCategory, RuleSeverity,
)

log = logging.getLogger("ai-engine.rule_engine.orchestrator")

# A rough draft took 177 s in the loop against a 300 s limit for the whole
# pipeline. Past this budget the loop stops iterating and returns the best
# version it has, instead of running into the caller's timeout and returning
# nothing.
TIME_BUDGET_SECONDS = float(os.getenv("RULE_ENGINE_TIME_BUDGET_SECONDS", "120"))

# The loop only rewrote below the pass mark, so a draft that scored 94.9 with
# seven open findings (three forced triads among them) shipped untouched. One
# surgical pass is now spent on findings of medium severity or worse, even when
# the piece passes. The best version seen is still the one returned.
POLISH_ENABLED = os.getenv("RULE_ENGINE_POLISH", "1") != "0"
POLISH_SEVERITIES = frozenset({RuleSeverity.CRITICAL, RuleSeverity.HIGH, RuleSeverity.MEDIUM})

# CTA settings that ask for a discussion. A closing question is then the
# requested behaviour, not engagement bait, and the rule must not fight it.
_DISCUSSION_CTA_WORDS = ("discuss", "comment", "question", "conversation")


def cta_invites_discussion(cta: str | None) -> bool:
    key = str(cta or "").strip().lower().replace(" ", "_").replace("-", "_")
    return any(word in key for word in _DISCUSSION_CTA_WORDS)


class RuleEngineOrchestrator:
    """
    SPEC-COMPLIANT Rule Engine Controller.

    ┌─────────────────────────────────────────────────────────────┐
    │  Agent 3 → Dynamic Rules generate (once, upfront)          │
    │                       ↓                                    │
    │  Agent 1 → Static Rules + Dynamic Rules BOTH validate      │
    │                       ↓                                    │
    │            Score >= PASS_THRESHOLD (65%)?                  │
    │                 YES ──► ✅ PASS                            │
    │                 NO  ──► Agent 2 (surgical fix)             │
    │                             ↓                              │
    │                   Back to Agent 1 (max 3x)                 │
    └─────────────────────────────────────────────────────────────┘
    """

    def __init__(self):
        self.validator   = StaticValidatorAgent()
        self.regenerator = RegenerationAgent()
        self.rule_gen    = DynamicRuleGeneratorAgent()

    async def process(
        self,
        content:       str,
        user_prompt:   str = "",
        brand_data:    dict | None = None,
        extra_context: dict | None = None,
        request_id:    str | None  = None,
    ) -> RuleEngineResult:

        request_id      = request_id or str(uuid.uuid4())
        start_time      = time.time()
        original        = content
        current         = content
        brand_data      = brand_data or {}
        improvement_log: list[dict] = []

        log.info(
            "[RuleEngine] Start | request=%s | content_len=%d",
            request_id, len(content)
        )

        # ── Agent 3: Dynamic Rules generate (ONCE, upfront) ───────────────
        dynamic_rules: DynamicRuleSet = await self.rule_gen.generate(
            user_prompt=user_prompt,
            brand_data=brand_data,
            request_id=request_id,
            extra_context=extra_context,
        )

        log.info(
            "[RuleEngine] Agent 3 done | dynamic_rules=%d",
            len(dynamic_rules.rules)
        )

        # Dynamic context for Agent 2 guidance
        dynamic_context = self._extract_dynamic_context(
            dynamic_rules, brand_data, extra_context
        )

        # The validator needs the brand's own facts to judge first-person
        # claims; without them every "we" sentence reads as invented.
        try:
            from services.verified_facts import build_verified_material
            verified_material = build_verified_material(brand_data)
        except Exception as e:  # pragma: no cover - never block a run on this
            log.warning("[RuleEngine] verified material unavailable: %s", e)
            verified_material = ""

        platform = (extra_context or {}).get("platform") or None

        # A rewrite is not guaranteed to be an improvement. The loop used to keep
        # whatever the last round produced, so a piece that scored 80 after round
        # two could ship as the 55 that round three made of it.
        best_content: str | None = None
        best_result: ValidationResult | None = None

        # False negative tracking
        initial_fn_count = 0
        final_fn_count   = 0

        cta_requested = cta_invites_discussion((extra_context or {}).get("cta"))
        polished = False

        # ── Agent 1 ↔ Agent 2 Loop ────────────────────────────────────────
        validation_result: ValidationResult | None = None
        iteration = 0

        while iteration < MAX_ITERATIONS:
            iteration += 1

            # ── Agent 1: BOTH Static + Dynamic rules validate ─────────────
            validation_result = await self.validator.validate(
                content=current,
                iteration=iteration,
                dynamic_rules=dynamic_rules.rules,
                verified_material=verified_material,
                platform=platform,
                cta_requested=cta_requested,
            )

            if best_result is None or (
                (validation_result.passed, validation_result.score)
                > (best_result.passed, best_result.score)
            ):
                best_content, best_result = current, validation_result

            fn_count = sum(
                1 for v in validation_result.violations
                if v.category == RuleCategory.FALSE_NEGATIVE
            )

            if iteration == 1:
                initial_fn_count = fn_count

            improvement_log.append({
                "iteration":           iteration,
                "score":               validation_result.score,
                "static_score":        validation_result.static_score,
                "dynamic_score":       validation_result.dynamic_score,
                "passed":              validation_result.passed,
                "total_violations":    len(validation_result.violations),
                "false_negatives":     fn_count,
                "critical_failures":   validation_result.critical_failures,
                "category_breakdown":  validation_result.category_breakdown,
                "content_length":      len(current),
                "timestamp":           datetime.now(timezone.utc).isoformat(),
            })

            log.info(
                "[RuleEngine] Iter %d/%d | score=%.1f%% | passed=%s | fn=%d",
                iteration, MAX_ITERATIONS,
                validation_result.score,
                validation_result.passed,
                fn_count,
            )

            elapsed_s = time.time() - start_time

            # ✅ Pass ho gaya — exit
            if validation_result.passed:
                polishable = [
                    v for v in validation_result.violations
                    if v.severity in POLISH_SEVERITIES
                ]
                if (
                    POLISH_ENABLED
                    and not polished
                    and polishable
                    and iteration < MAX_ITERATIONS
                    and elapsed_s < TIME_BUDGET_SECONDS
                ):
                    polished = True
                    log.info(
                        "[RuleEngine] Passed at iter %d with %d open finding(s) of "
                        "medium severity or worse - one polish pass",
                        iteration, len(polishable),
                    )
                    current = await self.regenerator.regenerate(
                        content=current,
                        validation_result=validation_result,
                        dynamic_context=dynamic_context,
                        iteration=iteration,
                        platform=platform,
                    )
                    continue
                final_fn_count = fn_count
                log.info("[RuleEngine] ✅ Passed at iter %d", iteration)
                break

            # Out of time: keep the best version so far rather than start a
            # round the caller's timeout would cut off.
            if elapsed_s >= TIME_BUDGET_SECONDS:
                final_fn_count = fn_count
                log.warning(
                    "[RuleEngine] Time budget of %.0fs spent after iter %d | "
                    "score=%.1f%% - returning the best version seen",
                    TIME_BUDGET_SECONDS, iteration, validation_result.score,
                )
                break

            # ✅ Last iteration — accept karo chahe pass ho ya na ho
            if iteration >= MAX_ITERATIONS:
                final_fn_count = fn_count
                log.warning(
                    "[RuleEngine] ⚠️ Max iterations reached | "
                    "final_score=%.1f%% — accepting content as-is",
                    validation_result.score,
                )
                break

            # ✅ Fail hua — fix karo aur retry karo
            log.info(
                "[RuleEngine] ❌ score=%.1f%% < %.1f%% — fixing...",
                validation_result.score, PASS_THRESHOLD,
            )
            current = await self.regenerator.regenerate(
                content=current,
                validation_result=validation_result,
                dynamic_context=dynamic_context,
                iteration=iteration,
                platform=platform,
            )

        # If a later round made things worse, hand back the best version seen.
        if (
            best_result is not None
            and validation_result is not None
            and best_content is not None
            and (best_result.passed, best_result.score)
            > (validation_result.passed, validation_result.score)
        ):
            log.info(
                "[RuleEngine] Final round scored %.1f%%, best round scored %.1f%% - returning the best",
                validation_result.score, best_result.score,
            )
            current, validation_result = best_content, best_result

        elapsed_ms = round((time.time() - start_time) * 1000, 2)

        return RuleEngineResult(
            original_content=original,
            final_content=current,
            static_validation=validation_result,
            dynamic_rules=dynamic_rules,
            total_iterations=iteration,
            improvement_log=improvement_log,
            final_score=validation_result.score if validation_result else 0.0,
            processing_time_ms=elapsed_ms,
            false_negatives_eliminated=max(0, initial_fn_count - final_fn_count),
        )

    def _extract_dynamic_context(
        self,
        dynamic_rules: DynamicRuleSet,
        brand_data:    dict,
        extra_context: dict | None,
    ) -> dict:
        ctx = {
            "brand_voice":     brand_data.get("voice", ""),
            "tone":            str(brand_data.get("tone_settings") or brand_data.get("tone") or ""),
            "target_audience": brand_data.get("target_audience", ""),
            "industry":        brand_data.get("industry", ""),
            "writing_style":   "",
            "platform":        (extra_context or {}).get("platform", ""),
            "campaign_goal":   (extra_context or {}).get("objective", ""),
        }
        return {k: v for k, v in ctx.items() if v}
