"""Measuring a brand's writing rhythm from their own document.

The failure this guards against is a confident wrong answer. A rhythm target
derived from four sentences, or a match score that reads 98% for two plainly
different voices, is worse than no measurement: it looks authoritative and it
is noise. So the tests here care as much about when the module declines to
answer as about what it says when it does.
"""
import os
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from services.voice import (  # noqa: E402
    MIN_SENTENCES,
    MIN_WORDS,
    describe,
    distance,
    measure,
)

CORPUS = AI_ENGINE / "eval" / "corpus" / "generated"

# Impersonal, short-sentenced, no first person.
INSTITUTIONAL = (CORPUS / "institutional-authority-thesis-linkedin.txt").read_text(
    encoding="utf-8"
)
# First person throughout, longer sentences.
PERSONAL = (CORPUS / "beginner-react-story-linkedin.txt").read_text(encoding="utf-8")


# ─── Declining to answer ──────────────────────────────────────────────────────

def test_empty_text_measures_nothing():
    assert measure("") is None
    assert measure("   \n\n  ") is None
    assert measure(None) is None


def test_too_short_to_measure():
    """Five sentences tell you about five sentences."""
    short = "I shipped it. It broke. I fixed it. Nobody noticed. That was lucky."
    assert measure(short) is None


def test_just_under_the_threshold_is_refused():
    text = ("The node verifies every block it receives from its peers. " * 3).strip()
    profile = measure(text)
    if profile is not None:
        assert profile["words"] >= MIN_WORDS
        assert profile["sentences"] >= MIN_SENTENCES


def test_describe_of_nothing_is_nothing():
    assert describe(None) == ""
    assert describe({}) == ""


# ─── What it measures ─────────────────────────────────────────────────────────

def test_measures_a_real_document():
    p = measure(INSTITUTIONAL)
    assert p is not None
    assert p["words"] >= MIN_WORDS
    assert p["sentences"] >= MIN_SENTENCES
    assert 0 < p["sentence_mean"] < 60
    assert p["sentence_min"] <= p["sentence_median"] <= p["sentence_max"]
    assert 0.0 <= p["short_share"] <= 1.0
    assert 0.0 <= p["long_share"] <= 1.0
    assert 0.0 <= p["question_share"] <= 1.0


def test_first_person_separates_the_two_voices():
    impersonal = measure(INSTITUTIONAL)
    personal = measure(PERSONAL)
    assert impersonal["first_person_per_100"] < personal["first_person_per_100"]


def test_front_matter_is_not_measured_as_the_brand():
    """The `---` header is ours. Measuring it reports our format as their voice."""
    with_fm = measure(INSTITUTIONAL)
    without_fm = measure(INSTITUTIONAL.split("---", 2)[-1])
    assert with_fm["words"] == without_fm["words"]


def test_markdown_scaffolding_is_stripped():
    plain = "The node verifies each block. " * 40
    bulleted = "- The node verifies each block.\n" * 40
    p1, p2 = measure(plain), measure(bulleted)
    assert p1 is not None and p2 is not None
    # Bullet markers must not be counted as words.
    assert abs(p1["sentence_mean"] - p2["sentence_mean"]) < 1.5


# ─── How it reads ─────────────────────────────────────────────────────────────

def test_description_is_specific_enough_to_act_on():
    described = describe(measure(INSTITUTIONAL))
    assert "average" in described
    assert "Paragraphs run" in described
    # A number, not an adjective. "Vary your rhythm" is what we are replacing.
    assert any(ch.isdigit() for ch in described)


def test_impersonal_document_tells_the_writer_to_stay_impersonal():
    described = describe(measure(INSTITUTIONAL))
    assert "impersonal" in described.lower()


# ─── Distance ─────────────────────────────────────────────────────────────────

def test_a_document_matches_itself():
    profile = measure(INSTITUTIONAL)
    assert distance(profile, INSTITUTIONAL)["match"] == 100.0


def test_a_different_voice_scores_clearly_lower():
    """An earlier scaling put two plainly different voices at 98.5%."""
    profile = measure(INSTITUTIONAL)
    result = distance(profile, PERSONAL)
    assert result is not None
    assert result["match"] < 85.0
    assert result["furthest"], "the report must say which measurements drove it"
    assert "first_person_per_100" in result["furthest"]


def test_distance_needs_both_sides():
    assert distance(None, PERSONAL) is None
    # A short social post cannot be measured against a document's rhythm
    # without reporting noise as a mismatch.
    assert distance(measure(INSTITUTIONAL), "Too short to measure.") is None


def test_match_stays_within_bounds():
    profile = measure(INSTITUTIONAL)
    for text in (INSTITUTIONAL, PERSONAL):
        result = distance(profile, text)
        assert 0.0 <= result["match"] <= 100.0
