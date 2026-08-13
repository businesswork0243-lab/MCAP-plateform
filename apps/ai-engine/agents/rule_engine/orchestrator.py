# apps/ai-engine/agents/rule_engine/orchestrator.py

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
    RuleEngineResult, ValidationResult, DynamicRuleSet, RuleCategory,
)

log = logging.getLogger("ai-engine.rule_engine.orchestrator")


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

        # False negative tracking
        initial_fn_count = 0
        final_fn_count   = 0

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
            )

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

            # ✅ Pass ho gaya — exit
            if validation_result.passed:
                final_fn_count = fn_count
                log.info("[RuleEngine] ✅ Passed at iter %d", iteration)
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
            )

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
            "tone":            str(brand_data.get("tone", "")),
            "target_audience": brand_data.get("target_audience", ""),
            "industry":        brand_data.get("industry", ""),
            "writing_style":   "",
            "platform":        (extra_context or {}).get("platform", ""),
            "campaign_goal":   (extra_context or {}).get("objective", ""),
        }
        return {k: v for k, v in ctx.items() if v}
