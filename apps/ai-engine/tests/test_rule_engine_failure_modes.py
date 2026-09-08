"""The rule engine used to fail open.

Every one of its rules is judged by an LLM. When that call failed — expired
key, rate limit, provider outage, malformed JSON — the validator marked
every rule as passed, which scored 100% and reported passed=True on content
nobody had checked. Fabricated content sailed through with a perfect score.

These tests pin the two properties that stop that: a failed check is
recorded as unverified rather than clean, and contrast negations are caught
by regex whether or not any LLM answers.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from agents.rule_engine.agents.static_validator import (  # noqa: E402
    StaticValidatorAgent,
    GROUNDING_RULE_IDS,
    GROUNDING_FAIL_CAP,
    PASS_THRESHOLD,
)

WITH_NEGATIONS = (
    "Scalability isn't about transaction speed. It's about accessibility.\n"
    "This isn't just a technical problem. It's an adoption problem."
)

CLEAN = (
    "Scalability has several dimensions beyond transaction throughput. "
    "State growth determines how much storage a full node must carry."
)


@pytest.fixture
def validator(monkeypatch):
    """A validator whose LLM call always fails, as during an outage."""
    agent = StaticValidatorAgent()

    async def always_fails(*_args, **_kwargs):
        raise RuntimeError("LLM provider unavailable")

    monkeypatch.setattr(
        "agents.rule_engine.agents.static_validator.complete", always_fails,
        raising=False,
    )
    return agent


def test_llm_outage_does_not_report_content_as_clean(validator):
    result = asyncio.run(validator.validate(content=CLEAN))

    # The old behaviour: score 100, passed True, zero violations.
    assert result.passed is False, (
        "an unreachable LLM must not produce a passing verdict"
    )
    assert any("UNVERIFIED" in f for f in result.critical_failures), (
        "the result must say the rules could not be checked"
    )


def test_llm_outage_still_catches_contrast_negations(validator):
    """SR000 is the most-emphasised rule in the system; a regex settles it."""
    result = asyncio.run(validator.validate(content=WITH_NEGATIONS))

    fn_violations = [v for v in result.violations if v.rule_id == "SR000"]
    assert fn_violations, "regex pass should flag the negations with no LLM"
    assert "isn't just" in " ".join(v.description for v in fn_violations).lower()


def test_clean_content_gets_no_false_negative_violations(validator):
    result = asyncio.run(validator.validate(content=CLEAN))
    assert not [v for v in result.violations if v.rule_id == "SR000"]


def test_grounding_rules_fail_below_the_pass_mark():
    """A grounding violation must fail, not merely lower the score.

    Hallucination rules were soft-capped at 78 against a pass mark of 65, so
    they were flagged and then passed anyway.
    """
    assert GROUNDING_RULE_IDS == {"SR014", "SR015", "SR016"}
    assert GROUNDING_FAIL_CAP < PASS_THRESHOLD


def test_grounding_rules_are_registered_and_critical():
    from agents.rule_engine.rules.static_rules import get_static_rules
    from agents.rule_engine.rules.rule_models import RuleSeverity, RuleCategory

    by_id = {r.id: r for r in get_static_rules()}
    for rule_id in GROUNDING_RULE_IDS:
        rule = by_id.get(rule_id)
        assert rule is not None, f"{rule_id} is missing from the rule set"
        assert rule.severity == RuleSeverity.CRITICAL
        assert rule.category == RuleCategory.HALLUCINATION
