# apps/ai-engine/agents/rule_engine/orchestrator.py

import time
import uuid
import logging
from typing import Optional, Dict, Any

from .agents.static_validator   import StaticValidatorAgent, MAX_ITERATIONS
from .agents.regeneration_agent import RegenerationAgent
from .agents.dynamic_rule_gen   import DynamicRuleGeneratorAgent
from .rules.rule_models         import (
    RuleEngineResult, ValidationResult, DynamicRuleSet, RuleCategory,
)

log = logging.getLogger("ai-engine.rule_engine.orchestrator")


class RuleEngineOrchestrator:
    """
    Main Rule Engine Controller.

    ┌─────────────────────────────────────────────────────────────────┐
    │  Agent 3  →  Generate Dynamic Rules (once, upfront)            │
    │                            ↓                                   │
    │  Agent 1  →  Static Validation                                 │
    │               False Negatives checked FIRST (SR000, SR001)     │
    │                            ↓                                   │
    │             Score ≥ 80% AND no critical failures?              │
    │                  YES ──────────────► ✅ DONE                   │
    │                  NO  ──► Agent 2 regenerates                   │
    │                            ↓                                   │
    │             Repeat validation (up to MAX_ITERATIONS)           │
    └─────────────────────────────────────────────────────────────────┘
    """

    def __init__(self):
        self.validator   = StaticValidatorAgent()
        self.regen_agent = RegenerationAgent()
        self.dynamic_gen = DynamicRuleGeneratorAgent()

    async def process(
        self,
        content:       str,
        user_prompt:   str = "",
        brand_data:    Optional[Dict[str, Any]] = None,
        extra_context: Optional[Dict[str, Any]] = None,
        request_id:    Optional[str] = None,
    ) -> RuleEngineResult:

        start_time = time.time()
        req_id = request_id or f"req_{uuid.uuid4().hex[:8]}"
        brand_info = brand_data or {}

        log.info("[Orchestrator] Starting rule engine | request=%s | content_len=%d", req_id, len(content))

        # Step 1: Agent 3 — Generate Dynamic Rules (upfront, once)
        dynamic_rules = await self.dynamic_gen.generate(
            user_prompt=user_prompt,
            brand_data=brand_info,
            request_id=req_id,
            extra_context=extra_context,
        )

        current_content = content
        improvement_log = []
        initial_fn_count = 0
        final_validation: Optional[ValidationResult] = None

        # Step 2: Loop — Agent 1 (Validate) & Agent 2 (Regenerate if needed)
        iteration = 1
        while iteration <= MAX_ITERATIONS:
            validation = await self.validator.validate(
                content=current_content,
                iteration=iteration,
            )
            final_validation = validation

            # Track initial false negative count in iteration 1
            if iteration == 1:
                initial_fn_count = len([
                    v for v in validation.violations
                    if v.category == RuleCategory.FALSE_NEGATIVE
                ])

            improvement_log.append({
                "iteration": iteration,
                "score": validation.score,
                "passed": validation.passed,
                "violations_count": len(validation.violations),
                "critical_failures": validation.critical_failures,
                "content_length": len(current_content),
            })

            # Check if passed or max iterations reached
            if validation.passed:
                log.info(
                    "[Orchestrator] Validation PASSED on iteration %d | score=%.1f%%",
                    iteration, validation.score
                )
                break

            if iteration == MAX_ITERATIONS:
                log.warning(
                    "[Orchestrator] Max iterations (%d) reached without passing | final_score=%.1f%%",
                    MAX_ITERATIONS, validation.score
                )
                break

            # Agent 2: Regenerate/rewrite content to fix violations
            log.info(
                "[Orchestrator] Validation failed (score=%.1f%%) | Regenerating iteration %d",
                validation.score, iteration
            )
            current_content = await self.regen_agent.regenerate(
                content=current_content,
                validation_result=validation,
                dynamic_context=dynamic_rules.context_used,
                iteration=iteration,
            )
            iteration += 1

        # Calculate final metrics
        final_fn_count = len([
            v for v in final_validation.violations
            if v.category == RuleCategory.FALSE_NEGATIVE
        ]) if final_validation else 0

        fn_eliminated = max(0, initial_fn_count - final_fn_count)
        elapsed_ms = round((time.time() - start_time) * 1000, 1)

        result = RuleEngineResult(
            original_content=content,
            final_content=current_content,
            static_validation=final_validation,
            dynamic_rules=dynamic_rules,
            total_iterations=len(improvement_log),
            improvement_log=improvement_log,
            final_score=final_validation.score if final_validation else 0.0,
            processing_time_ms=elapsed_ms,
            false_negatives_eliminated=fn_eliminated,
        )

        log.info(
            "[Orchestrator] Completed in %sms | iterations=%d | final_score=%.1f%% | fn_eliminated=%d",
            elapsed_ms, len(improvement_log), result.final_score, fn_eliminated
        )
        return result
