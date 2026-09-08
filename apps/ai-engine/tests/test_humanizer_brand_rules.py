"""A brand's banned phrases have to reach the humanizer's prompt.

They did not. The prompt built its list as BANNED_PHRASES (42 built-ins)
followed by the brand's own phrases, then truncated the combined list to the
first 20 — so every brand-configured phrase was cut off before the model saw
it. Users set banned phrases in their brand profile and the humanizer
silently ignored all of them.
"""
import os
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from agents.humanizer import (  # noqa: E402
    _build_user_prompt,
    BANNED_PHRASES,
    normalize_tonality,
)

NO_ISSUES = {"false_negative_count": 0, "patterns": []}


def build(brand_phrases=None, tonality=None):
    return _build_user_prompt(
        content="Some draft content about state growth.",
        intensity="medium",
        tonality=tonality,
        language="English",
        brand_phrases=brand_phrases,
        pre_issues=NO_ISSUES,
    )


def test_every_brand_phrase_reaches_the_prompt():
    brand = ["game-changer", "revolutionary", "leverage", "seamless"]
    prompt = build(brand_phrases=brand)
    missing = [p for p in brand if p not in prompt]
    assert not missing, f"brand banned phrases never shown to the model: {missing}"


def test_brand_phrases_survive_a_long_brand_list():
    """Even a brand with more phrases than the display cap keeps all of them."""
    brand = [f"forbidden-term-{i}" for i in range(25)]
    prompt = build(brand_phrases=brand)
    missing = [p for p in brand if p not in prompt]
    assert not missing, f"{len(missing)} brand phrases were truncated away"


def test_generic_phrases_still_appear():
    prompt = build(brand_phrases=["game-changer"])
    shown = [p for p in BANNED_PHRASES if p in prompt]
    assert len(shown) >= 10, "the built-in list should still guide the model"


def test_no_brand_list_still_produces_a_prompt():
    prompt = build(brand_phrases=None)
    assert "AVOID" in prompt.upper() or any(p in prompt for p in BANNED_PHRASES)


def test_case_differences_do_not_duplicate_a_phrase():
    prompt = build(brand_phrases=["Leverage"])
    # "Leverage" is also a built-in in lowercase; it should not be listed twice.
    assert prompt.lower().count("leverage") <= 2


def test_tonality_from_brand_reaches_the_prompt():
    # Brand keys arrive as "confidence"/"technical"; the prompt renders the
    # normalised trait names the rules are written against.
    prompt = build(tonality={"confidence": 9, "technical": 8})
    assert "TONE TO MAINTAIN" in prompt
    assert "CONFIDENT" in prompt.upper()


# ── Tone vocabulary ───────────────────────────────────────────────────────────
# Brand profiles and TONALITY_RULES used disjoint vocabularies, so a brand's
# tone sliders matched nothing and the tone block was always empty.

def test_brand_tone_vocabulary_is_understood():
    out = normalize_tonality(
        {"confidence": 9, "empathy": 8, "enthusiasm": 7, "humor": 2}
    )
    assert out["confident"] == 9
    assert out["empathetic"] == 8
    assert out["excited"] == 7
    assert out["playful"] == 2


def test_per_piece_vocabulary_still_works():
    out = normalize_tonality({"excited": 8, "confident": 9, "curious": 4})
    assert out == {"excited": 8, "confident": 9, "curious": 4}


def test_spreadsheet_tone_prefix_is_stripped():
    assert normalize_tonality({"tone_excited": 8})["excited"] == 8


def test_two_sources_for_one_trait_keep_the_stronger():
    out = normalize_tonality({"confidence": 4, "assertiveness": 9})
    assert out["confident"] == 9


def test_unknown_and_non_numeric_values_are_dropped():
    out = normalize_tonality({"storytelling": 9, "confidence": "high", "x": None})
    assert "confident" not in out
    assert out == {}


def test_non_dict_tone_is_safe():
    assert normalize_tonality(None) == {}
    assert normalize_tonality("confident") == {}
