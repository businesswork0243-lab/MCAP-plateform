"""Deterministic tell detectors.

These run without an LLM, which is the point: the rule engine's judgement is
LLM-based and used to mark everything clean when that call failed. Anything
provable by regex should be proved by regex.
"""
import os
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from services.tells import (  # noqa: E402
    find_tells,
    tell_report,
    format_for_prompt,
    PATTERNS,
    PATTERNS_BY_ID,
)


def ids_in(text: str) -> set[str]:
    return {t["id"] for t in find_tells(text)}


# ─── Strong patterns: one sighting is enough ──────────────────────────────────

@pytest.mark.parametrize("pattern_id,text", [
    ("TELL02", "Caching cuts repeat work.\n\nThat is the real win."),
    ("TELL03", "At its core, what really matters is organizational readiness."),
    ("TELL04", "Let's dive into how caching works. Here's what you need to know."),
    ("TELL05", "This isn't mainly about prompt length. A tempting approach would be to retry."),
    ("TELL13", "The institute was established in 1989, marking a pivotal moment."),
    ("TELL14", "He is associated with the orchestra, in connection with the anniversary."),
    ("TELL15", "The palette is blue and gold, symbolizing the region's natural beauty."),
    ("TELL16", "Nestled in the heart of the region, the town boasts stunning views."),
    ("TELL17", "Experts believe it plays a role. Studies show adoption is rising."),
    ("TELL22", "Great question! Here's a draft for you. I hope this helps!"),
    ("TELL23", "While details are limited, it appears that the policy changed."),
])
def test_strong_pattern_is_found(pattern_id, text):
    assert pattern_id in ids_in(text)


def test_strong_tells_count_on_a_single_sighting():
    report = tell_report("The museum stands as a testament to the city's enduring legacy.")
    assert report["strong_count"] >= 1
    assert report["effective_count"] >= 1


# ─── Structural finders ───────────────────────────────────────────────────────

def test_forced_triad():
    text = "The event features keynote sessions, panel discussions, and networking opportunities."
    assert "TELL06" in ids_in(text)


def test_two_item_list_is_not_a_triad():
    assert "TELL06" not in ids_in("The event features talks and panels.")


def test_repeated_sentence_openings():
    text = "She noted the door. She noted the lock. She filed both away."
    assert "TELL07" in ids_in(text)


def test_varied_openings_are_clean():
    text = "She noted the door and its lock. Both went into the file. Nothing else moved."
    assert "TELL07" not in ids_in(text)


def test_dashes_as_connector():
    text = "The policy — announced without warning — affects thousands of workers."
    assert "TELL08" in ids_in(text)


def test_fragment_row_is_a_closer():
    text = (
        "AlphaEvolve changed the search.\n\n"
        "No preference. No aesthetic prior. No nostalgia."
    )
    assert "TELL02" in ids_in(text)


def test_bold_labels_and_decorative_headings():
    text = "## Strategic Negotiations And Partnerships\n\n- **Performance:** it improved\n"
    found = ids_in(text)
    assert "TELL19" in found
    assert "TELL20" in found


def test_heading_echo():
    text = "## Performance benchmarks\n\nPerformance benchmarks matter for teams."
    assert "TELL24" in ids_in(text)


# ─── Weak-alone accounting ────────────────────────────────────────────────────

def test_a_single_dash_does_not_count_on_its_own():
    """A careful writer uses a dash. Nine dashes and three triads is a machine."""
    report = tell_report("The policy, announced late, affects workers — many of them.")
    assert report["effective_count"] == 0


def test_repeated_weak_pattern_clears_its_own_threshold():
    text = (
        "The policy — announced late — affects workers. "
        "The rollout — slower than planned — continues. "
        "The result — predictable — is delay."
    )
    report = tell_report(text)
    assert report["counts"]["TELL08"] >= 3
    assert report["effective_count"] > 0


def test_two_different_weak_patterns_together_count():
    text = (
        "The team is cross-functional and the report is data-driven. "
        "It serves as a reference, represents a shift, and refers to the plan."
    )
    report = tell_report(text)
    weak_ids = {t["id"] for t in report["tells"] if t["strength"] == "weak"}
    assert len(weak_ids) >= 2
    assert report["effective_count"] > 0


# ─── Protected spans ──────────────────────────────────────────────────────────

def test_code_and_urls_are_never_flagged():
    text = "Run `npm run build --watch -- --force` and read https://ex.com/a--b for details."
    assert "TELL08" not in ids_in(text)


# ─── Density and prompt output ────────────────────────────────────────────────

def test_density_is_per_hundred_words():
    clean = " ".join(["state growth determines node storage cost"] * 20)
    assert tell_report(clean)["per_100_words"] == 0.0


def test_clean_text_produces_nothing():
    text = (
        "State growth determines how much storage a full node must carry. "
        "As the state expands, the hardware needed to verify the chain rises with it."
    )
    report = tell_report(text)
    assert report["effective_count"] == 0
    assert format_for_prompt(text) == ""


def test_prompt_output_quotes_the_offending_sentence():
    """The humanizer can only fix what it is shown."""
    text = "Nestled in the heart of the valley, the town boasts stunning views."
    prompt = format_for_prompt(text)
    assert "Sales language" in prompt
    assert "boasts" in prompt.lower()


# ─── A real draft this pipeline produced ──────────────────────────────────────

REAL_DRAFT = (
    "Blockchain scalability has a measurement problem.\n\n"
    "Most teams benchmark throughput in transactions per second. They optimize "
    "consensus efficiency, compress signatures, and shard execution—as if the "
    "network were a single machine.\n\n"
    "But the binding constraint lives elsewhere."
)


def test_real_draft_that_passed_every_existing_check():
    """This went through the whole pipeline and was scored clean."""
    found = ids_in(REAL_DRAFT)
    assert "TELL06" in found, "forced triad went undetected"
    assert "TELL08" in found, "em dash connector went undetected"


def test_taxonomy_is_internally_consistent():
    assert len(PATTERNS) == len(PATTERNS_BY_ID)
    for p in PATTERNS:
        assert p.regexes or p.finder, f"{p.id} detects nothing"
        assert p.strength in ("strong", "weak")
