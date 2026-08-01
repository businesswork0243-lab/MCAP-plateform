# apps/ai-engine/agents/rule_engine/agents/dynamic_rule_gen.py

import json
import logging
from datetime import datetime, timezone

from agents.rule_engine.rules.rule_models import (
    Rule, RuleType, RuleCategory, RuleSeverity, DynamicRuleSet,
)
from services.llm import complete

log = logging.getLogger("ai-engine.rule_engine.dynamic_gen")

DYNAMIC_GEN_SYSTEM = """You are a content strategy expert.
You create precise, actionable writing rules based on brand identity
and campaign context.

Generate rules that are:
- Specific and measurable by an LLM validator
- Unique to the brand/audience provided
- Different from universal quality rules (grammar, false negatives, hallucinations)
- Directly tied to the content objective

Return ONLY valid JSON. No markdown, no explanation."""


class DynamicRuleGeneratorAgent:
    """
    Agent 3 — Generates custom rules from brand + request context.
    Runs once, before the validation loop.
    """

    # ✅ FIX: Both short names AND enum values as keys
    # Before: only short names like "industry"
    # After:  also enum values like "industry_specific"
    # So agar LLM koi bhi form return kare — map karega
    CATEGORY_MAP = {
        # ── Short names (LLM usually returns these) ───────────────────────
        "brand_voice":       RuleCategory.BRAND_VOICE,
        "tone":              RuleCategory.TONE,
        "writing_style":     RuleCategory.WRITING_STYLE,
        "target_audience":   RuleCategory.TARGET_AUDIENCE,
        "industry":          RuleCategory.INDUSTRY,
        "campaign":          RuleCategory.CAMPAIGN,
        "seo":               RuleCategory.SEO,
        "user_preference":   RuleCategory.USER_PREF,

        # ── Enum values as fallback keys ──────────────────────────────────
        "industry_specific":  RuleCategory.INDUSTRY,
        "campaign_objective": RuleCategory.CAMPAIGN,
        "seo_optimization":   RuleCategory.SEO,
        "user_pref":          RuleCategory.USER_PREF,
        "brand":              RuleCategory.BRAND_VOICE,
        "audience":           RuleCategory.TARGET_AUDIENCE,

        # ── Extra aliases LLM might use ───────────────────────────────────
        "voice":             RuleCategory.BRAND_VOICE,
        "style":             RuleCategory.WRITING_STYLE,
        "format":            RuleCategory.WRITING_STYLE,
        "keywords":          RuleCategory.SEO,
        "search":            RuleCategory.SEO,
        "engagement":        RuleCategory.CAMPAIGN,
        "objective":         RuleCategory.CAMPAIGN,
    }

    def __init__(self):
        pass

    # ─────────────────────────────────────────────────────────────────────────
    async def generate(
        self,
        user_prompt:   str,
        brand_data:    dict,
        request_id:    str,
        extra_context: dict | None = None,
    ) -> DynamicRuleSet:

        log.info("[DynamicGen] Generating rules | request=%s", request_id)
        context = self._build_context(user_prompt, brand_data, extra_context)

        prompt = f"""Analyze this content request and generate 5-7 specific writing rules.

## Context:
{json.dumps(context, indent=2)}

## Required Response Format:
{{
  "rules": [
    {{
      "category":    "brand_voice|tone|writing_style|target_audience|industry|campaign|seo|user_preference",
      "severity":    "critical|high|medium|low",
      "name":        "Rule name (max 5 words)",
      "description": "What this rule ensures",
      "instruction": "Exact instruction for LLM validator to check compliance",
      "weight":      0.08,
      "examples": {{
        "good": "Example following this rule",
        "bad":  "Example violating this rule"
      }}
    }}
  ]
}}

IMPORTANT:
- Use ONLY these category values: brand_voice, tone, writing_style, target_audience, industry, campaign, seo, user_preference
- Do NOT duplicate static rules (grammar, false negatives, hallucinations)
- Focus ONLY on brand-specific and audience-specific standards
- Each rule must be uniquely checkable
- Return ONLY valid JSON"""

        try:
            response, _ = await complete(
                system=DYNAMIC_GEN_SYSTEM,
                user=prompt,
                temperature=0.4,
                max_tokens=2000,
            )
            rules = self._parse(response, request_id)

        except Exception as e:
            log.error("[DynamicGen] Failed: %s", e)
            rules = self._fallback_rules(request_id)

        rule_set = DynamicRuleSet(
            brand_id=str(brand_data.get("id", "unknown")),
            request_id=request_id,
            generated_at=datetime.now(timezone.utc).isoformat(),
            rules=rules,
            context_used=context,
        )

        log.info(
            "[DynamicGen] Generated %d rules | request=%s",
            len(rules), request_id,
        )
        return rule_set

    # ─────────────────────────────────────────────────────────────────────────
    def _build_context(
        self,
        user_prompt:   str,
        brand_data:    dict,
        extra_context: dict | None,
    ) -> dict:
        ctx: dict = {
            "user_request": user_prompt,
            "brand": {
                "name":            brand_data.get("name", ""),
                "industry":        brand_data.get("industry", ""),
                "voice":           brand_data.get("voice", ""),
                "tone":            brand_data.get("tone", {}),
                "target_audience": brand_data.get("target_audience", ""),
                "core_values":     brand_data.get("core_values", []),
                "stands_for":      brand_data.get("stands_for", []),
                "stands_against":  brand_data.get("stands_against", []),
                "banned_phrases":  brand_data.get("banned_phrases", []),
                "preferred_terms": brand_data.get("preferred_terms", []),
                "life_purpose":    brand_data.get("life_purpose", ""),
            },
        }

        if extra_context:
            ctx["campaign"] = {
                "platform":     extra_context.get("platform", ""),
                "objective":    extra_context.get("objective", ""),
                "content_type": extra_context.get("content_type", ""),
                "keywords":     extra_context.get("keywords", []),
                "cta":          extra_context.get("cta", ""),
            }

        # ✅ Remove empty values to reduce token usage
        ctx["brand"] = {
            k: v for k, v in ctx["brand"].items()
            if v and v != [] and v != {}
        }

        return ctx

    # ─────────────────────────────────────────────────────────────────────────
    def _parse(self, response: str, request_id: str) -> list[Rule]:
        rules: list[Rule] = []

        try:
            clean = response.strip()

            # Strip markdown code blocks if present
            if clean.startswith("```"):
                parts = clean.split("```")
                clean = parts[1] if len(parts) > 1 else clean
                if clean.startswith("json"):
                    clean = clean[4:]
            clean = clean.strip()

            data = json.loads(clean)

            for i, r in enumerate(data.get("rules", []), 1):

                # ✅ FIX: Try all forms of category string
                raw_category = r.get("category", "user_preference").lower().strip()

                # Direct map lookup
                category = self.CATEGORY_MAP.get(raw_category)

                # If not found — try partial match
                if category is None:
                    for key, val in self.CATEGORY_MAP.items():
                        if key in raw_category or raw_category in key:
                            category = val
                            log.debug(
                                "[DynamicGen] Partial category match: '%s' → '%s'",
                                raw_category, key,
                            )
                            break

                # Final fallback
                if category is None:
                    log.warning(
                        "[DynamicGen] Unknown category '%s' → defaulting to USER_PREF",
                        raw_category,
                    )
                    category = RuleCategory.USER_PREF

                # ✅ Validate severity
                raw_severity = r.get("severity", "medium").lower().strip()
                try:
                    severity = RuleSeverity(raw_severity)
                except ValueError:
                    log.warning(
                        "[DynamicGen] Unknown severity '%s' → defaulting to MEDIUM",
                        raw_severity,
                    )
                    severity = RuleSeverity.MEDIUM

                # ✅ Validate weight
                weight = float(r.get("weight", 0.08))
                weight = max(0.01, min(0.25, weight))  # Clamp 0.01–0.25

                # ✅ Skip if no instruction
                instruction = r.get("instruction", "").strip()
                if not instruction:
                    log.warning(
                        "[DynamicGen] Rule %d has no instruction — skipping", i
                    )
                    continue

                rules.append(Rule(
                    id=f"DR{request_id[:6].upper()}{i:03d}",
                    type=RuleType.DYNAMIC,
                    category=category,
                    severity=severity,
                    name=r.get("name", f"Dynamic Rule {i}"),
                    description=r.get("description", ""),
                    instruction=instruction,
                    weight=weight,
                    examples=r.get("examples"),
                ))

        except Exception as e:
            log.error("[DynamicGen] Parse error: %s", e)
            rules = self._fallback_rules(request_id)

        return rules

    # ─────────────────────────────────────────────────────────────────────────
    def _fallback_rules(self, request_id: str) -> list[Rule]:
        """
        Fallback rules when LLM fails or returns unparseable response.
        ✅ FIX: More useful fallback rules — 3 instead of 1
        """
        prefix = f"DR{request_id[:6].upper()}"

        return [
            Rule(
                id=f"{prefix}001",
                type=RuleType.DYNAMIC,
                category=RuleCategory.TONE,
                severity=RuleSeverity.MEDIUM,
                name="Maintain Professional Tone",
                description="Content should maintain consistent professional tone",
                instruction=(
                    "Verify the content uses a professional, clear tone throughout. "
                    "Flag if tone becomes casual, aggressive, or inconsistent."
                ),
                weight=0.08,
            ),
            Rule(
                id=f"{prefix}002",
                type=RuleType.DYNAMIC,
                category=RuleCategory.WRITING_STYLE,
                severity=RuleSeverity.LOW,
                name="Clear Direct Language",
                description="Content should use clear, direct language",
                instruction=(
                    "Check that content uses direct, active language. "
                    "Flag excessive use of passive voice or indirect phrasing."
                ),
                weight=0.06,
            ),
            Rule(
                id=f"{prefix}003",
                type=RuleType.DYNAMIC,
                category=RuleCategory.CAMPAIGN,
                severity=RuleSeverity.LOW,
                name="Audience Relevance",
                description="Content should be relevant to the target audience",
                instruction=(
                    "Verify content addresses the intended audience's needs "
                    "and interests. Flag if content feels generic or off-topic."
                ),
                weight=0.06,
            ),
        ]