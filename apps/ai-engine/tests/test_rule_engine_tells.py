"""The tell detectors, wired into the rule engine.

Two properties matter here and neither is obvious from reading the code.

First, adding twenty-two rules must not add a single LLM call. They are
decided by regex, so batching them to the model would pay for a verdict we
already have — and the model is the worse judge of "is this an em dash".

Second, they must survive an outage. The LLM-judged rules go unverified when
the provider is down, which is correct but leaves the piece unchecked. The
deterministic sweep keeps reporting, so an outage no longer means silence.
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
    TELL_DENSITY_FAIL,
    TELL_DENSITY_CAP,
    PASS_THRESHOLD,
    MAX_TELL_VIOLATIONS,
)
from agents.rule_engine.rules.static_rules import (  # noqa: E402
    STATIC_RULES,
    get_deterministic_rules,
    get_llm_judged_rules,
)
from agents.rule_engine.rules.tell_rules import TELL_RULE_IDS, FIXES  # noqa: E402
from services.tells import PATTERNS, sentence_at, tell_report  # noqa: E402


# A draft the pipeline actually produced, which passed every check that
# existed before these rules.
REAL_DRAFT = (
    "Blockchain scalability has a measurement problem.\n\n"
    "Most teams benchmark throughput in transactions per second. They optimize "
    "consensus efficiency, compress signatures, and shard execution—as if the "
    "network were a single machine.\n\n"
    "But the binding constraint lives elsewhere."
)

# Deliberately overloaded: measured at 6.78 effective tells per 100 words.
TELL_RIDDEN = (
    "Great question. In the world of modern business, this matters.\n\n"
    "It is a journey, not a destination.\n\n"
    "Teams optimize workflows, reduce overhead, and scale operations—all at once. "
    "Some might argue that this is difficult. But the data speaks for itself.\n\n"
    "This changes everything.\n\n"
    "Experts agree that leveraging best-in-class, future-proof solutions delivers "
    "unprecedented value, driving growth and unlocking potential."
)

CLEAN = (
    "State growth determines how much storage a full node must carry. "
    "As the state expands, the hardware needed to verify the chain rises with it."
)

# One em dash, used the way a careful writer uses one.
LONE_WEAK = "State growth determines node cost—and that cost compounds over time."


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


# ─── Cost ─────────────────────────────────────────────────────────────────────

def test_deterministic_rules_never_reach_the_llm():
    agent = StaticValidatorAgent()
    batched = agent.other_static + agent.fn_rules
    assert [r.id for r in batched if r.deterministic] == []
    # The seventeen rules that existed before are still the only ones costing
    # a call. If this number rises, someone made a tell rule LLM-judged.
    assert len(batched) == len(get_llm_judged_rules())
    assert len(batched) == 17


def test_all_twenty_two_patterns_have_a_rule():
    assert len(get_deterministic_rules()) == len(PATTERNS) == 22
    assert set(TELL_RULE_IDS) == {p.id for p in PATTERNS}


def test_rule_ids_are_unique():
    ids = [r.id for r in STATIC_RULES]
    assert len(ids) == len(set(ids))


def test_every_pattern_has_a_fix_instruction():
    """A violation with no suggestion gives the rewrite prompt nothing."""
    for pattern in PATTERNS:
        assert FIXES.get(pattern.id), f"{pattern.id} has no fix text"


# ─── Detection ────────────────────────────────────────────────────────────────

def test_real_draft_is_caught(validator):
    violations, passed, density = validator._detect_tells(REAL_DRAFT)
    assert violations, "the draft that passed every old check should not be clean"
    fired = {v.rule_id for v in violations}
    assert "SR021" in fired          # forced triads
    assert "SR023" in fired          # dashes
    assert density > 0


def test_clean_text_produces_no_violations(validator):
    violations, passed, density = validator._detect_tells(CLEAN)
    assert violations == []
    assert density == 0.0
    # Every tell rule is reported as passed, not merely absent.
    assert len(passed) == 22


def test_a_single_weak_pattern_is_not_a_violation(validator):
    """One em dash is a writing choice. Failing it would punish our users."""
    violations, _, density = validator._detect_tells(LONE_WEAK)
    assert violations == []
    assert density == 0.0


def test_violations_quote_a_whole_sentence(validator):
    """A half-word fragment names nothing the model can find and fix."""
    violations, _, _ = validator._detect_tells(REAL_DRAFT)
    for v in violations:
        assert v.location
        assert v.location in REAL_DRAFT or v.location.startswith("…")
        # The dash detector matches a window around the dash; the violation
        # must widen it rather than pass the window through.
        assert not v.location.startswith("tures,")


def test_violations_are_capped(validator):
    violations, _, _ = validator._detect_tells(TELL_RIDDEN * 6)
    assert len(violations) <= MAX_TELL_VIOLATIONS


def test_each_sentence_reported_once_per_pattern(validator):
    violations, _, _ = validator._detect_tells(REAL_DRAFT)
    keys = [(v.rule_id, v.location) for v in violations]
    assert len(keys) == len(set(keys))


# ─── Scoring ──────────────────────────────────────────────────────────────────

def test_tell_ridden_content_is_capped_below_the_pass_mark(validator):
    density = tell_report(TELL_RIDDEN)["per_100_words"]
    assert density >= TELL_DENSITY_FAIL, (
        f"sample no longer exceeds the threshold ({density} < {TELL_DENSITY_FAIL})"
    )

    result = asyncio.run(validator.validate(TELL_RIDDEN))
    assert result.score <= TELL_DENSITY_CAP
    assert TELL_DENSITY_CAP < PASS_THRESHOLD, "the cap must trigger regeneration"


def test_ordinary_content_is_not_capped_by_density(validator):
    """The cap is for tell-ridden output, not for our own current writing."""
    density = tell_report(REAL_DRAFT)["per_100_words"]
    assert density < TELL_DENSITY_FAIL


# ─── Outage behaviour ─────────────────────────────────────────────────────────

def test_tells_still_report_when_the_llm_is_down(validator):
    result = asyncio.run(validator.validate(REAL_DRAFT))

    # The LLM-judged rules could not be checked, so the piece does not pass.
    assert result.passed is False
    assert any(c.startswith("UNVERIFIED") for c in result.critical_failures)

    # But the regex rules answered, and their verdicts are real.
    tell_ids = set(TELL_RULE_IDS.values())
    reported = {v.rule_id for v in result.violations} & tell_ids
    assert reported, "the deterministic sweep should report during an outage"


def test_unverified_rules_are_not_counted_as_passed(validator):
    result = asyncio.run(validator.validate(CLEAN))
    # Only the tell rules may appear as passed; nothing the LLM was asked.
    assert set(result.passed_rules) <= set(TELL_RULE_IDS.values())


# ─── sentence_at ──────────────────────────────────────────────────────────────

def test_sentence_at_widens_a_mid_word_match():
    index = REAL_DRAFT.index("—")
    quote = sentence_at(REAL_DRAFT, index)
    assert quote.startswith("They optimize")
    assert quote.endswith("single machine.")


def test_sentence_at_clips_a_runaway_sentence():
    long_sentence = "word " * 200 + "end."
    quote = sentence_at(long_sentence, 500, max_len=100)
    assert len(quote) <= 102          # the cap plus the two ellipses
    assert "…" in quote


def test_sentence_at_handles_empty_and_out_of_range():
    assert sentence_at("", 0) == ""
    assert sentence_at("Short.", 999) == "Short."
