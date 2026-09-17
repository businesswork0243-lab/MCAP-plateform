"""The structural reading of a draft.

This score is advisory and must stay that way. The tests below pin three
things: that it separates writing built the way models build it from writing
built the way people do, that it declines to score text too short to read, and
that it never reaches the pass/fail decision.
"""
import os
import re
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from services.structure import (  # noqa: E402
    MIN_WORDS,
    read_features,
    score,
)

CORPUS = AI_ENGINE / "eval" / "corpus" / "generated"


def _sample(name: str) -> str:
    raw = (CORPUS / f"{name}.txt").read_text(encoding="utf-8")
    return re.sub(r"\A---\n.*?\n---\n", "", raw, flags=re.S).strip()


REAL_OUTPUT = [
    _sample("institutional-authority-thesis-linkedin"),
    _sample("beginner-react-story-linkedin"),
    _sample("blockchain-scalability-thesis-linkedin"),
]

# Everything the StoryScope contrasts describe, in one piece: it explains its
# own moral, names nothing checkable, runs on a single track, never addresses
# the reader.
AI_SHAPED = (
    "Modern teams face a complex challenge in an evolving landscape.\n\n"
    "Systems grow, requirements shift, and priorities change. Every "
    "organisation must adapt to survive. The pace of change has accelerated "
    "dramatically across every sector of the economy.\n\n"
    "The tooling matters. The process matters. The culture matters most of all.\n\n"
    "Leaders who embrace this reality will thrive. Those who resist will "
    "struggle to keep pace with competitors who have already made the "
    "transition.\n\n"
    "Ultimately, the lesson here is that adaptability determines success."
)


# ─── Declining to answer ──────────────────────────────────────────────────────

def test_empty_text_scores_nothing():
    assert score("") is None
    assert score("   ") is None
    assert score(None) is None


def test_too_short_to_read_structurally():
    """A two-line post has no closing paragraph and no room for a counter-case."""
    assert score("One line. Then another line.") is None


def test_the_floor_is_respected():
    result = score("word " * (MIN_WORDS + 20))
    assert result is not None
    assert result["features"]["words"] >= MIN_WORDS


# ─── Discrimination ───────────────────────────────────────────────────────────

def test_ai_shaped_writing_scores_below_our_real_output():
    ai = score(AI_SHAPED)["score"]
    for text in REAL_OUTPUT:
        assert score(text)["score"] > ai, (
            "a piece built the way models build them should not outscore "
            "the pipeline's own output"
        )


def test_ai_shaped_writing_is_told_why():
    result = score(AI_SHAPED)
    assert len(result["reasons"]) >= 3
    joined = " ".join(result["reasons"]).lower()
    assert "own meaning" in joined
    assert "single track" in joined


def test_scores_stay_in_range():
    for text in REAL_OUTPUT + [AI_SHAPED]:
        assert 0 <= score(text)["score"] <= 100


# ─── The individual features ──────────────────────────────────────────────────

def test_self_explaining_closing_is_caught():
    closing = (
        "The team shipped the migration over four weekends.\n\n"
        "Ultimately, the lesson here is that preparation beats heroics."
    )
    assert read_features(closing)["explains_its_own_meaning"] is True


def test_a_subject_mentioned_mid_piece_is_not_a_self_explaining_closing():
    """Only the closing counts. A piece may name its subject anywhere."""
    text = (
        "What this means for treasury teams is a question worth asking early.\n\n"
        "Revocation happens once, in the authority layer."
    )
    assert read_features(text)["explains_its_own_meaning"] is False


def test_reader_address_is_detected():
    assert read_features("You already know how this ends.")["addresses_reader"] is True
    assert read_features("The node verifies the block.")["addresses_reader"] is False


def test_counter_case_is_detected():
    assert read_features(
        "Throughput matters. However, state growth binds sooner."
    )["holds_a_counter_case"] is True
    assert read_features(
        "Throughput matters. State growth matters more."
    )["holds_a_counter_case"] is False


def test_spelled_out_quantities_count_as_specifics():
    """A real draft lost fifteen points for having no specifics when it had one."""
    assert read_features(
        "A chain can process a thousand transactions per second."
    )["names_specifics"] is True


def test_digits_and_years_count_as_specifics():
    assert read_features("Settlement fell to 400ms in 2024.")["names_specifics"] is True


def test_uncertainty_is_detected():
    assert read_features(
        "Whether that holds at scale remains an open question."
    )["admits_uncertainty"] is True


# ─── It must stay advisory ────────────────────────────────────────────────────

def test_the_report_says_it_is_advisory():
    assert score(AI_SHAPED)["advisory"] is True


def test_writing_score_is_absent_from_the_qa_weights():
    """If this ever gains weight, every score already stored silently changes."""
    from agents.qa_agent import SCORE_WEIGHTS

    assert "writingScore" not in SCORE_WEIGHTS
    assert "voiceMatch" not in SCORE_WEIGHTS
    assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 1e-9
