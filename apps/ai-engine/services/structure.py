"""A structural reading of a draft, adapted from the StoryScope findings.

StoryScope (COLM 2026) trained classifiers over 61,608 stories and found that
structure carried more signal than style: 93.2% macro-F1 from narrative
structure alone against 85.8% from style alone. More usefully for us, running
an AI rewriter over the text to strip clichés and purple prose moved detection
by 1.6 points. Editing words does not change how a piece is built.

Six of their behavioural contrasts have obvious marketing equivalents, and all
six can be read off the text without a model:

    narrator states the theme          AI 77%  human 52%
    single track, no counter-case      AI 79%  human 57%
    names specific references          AI 24%  human 47%
    addresses the reader               AI  7%  human 28%

What this is not
----------------
Not the StoryScope classifier. Theirs was trained on 5,000-word fiction with
characters and plots; this is regex over marketing copy, and the thresholds are
judgement rather than measurement. It is also not an AI detector — Wikipedia is
explicit that detectors carry non-trivial error rates and that humans perform
near chance, and a public claim built on this would be dishonest.

It is an internal writing signal, reported and never enforced. Grounding blocks
a piece because grounding is about truth. This is about taste, and a person
should be the one to overrule it.
"""
from __future__ import annotations

import re

from services.tells import tell_report

# ─── The six features ─────────────────────────────────────────────────────────

# "The lesson here is…", "What this means is…" — the piece explaining its own
# point rather than trusting the reader to take it.
_STATES_ITS_MEANING = re.compile(
    r"(?i)\b("
    r"the (lesson|takeaway|moral|point) (here |there )?is"
    r"|what this (means|shows|teaches|tells us)"
    r"|the real (lesson|question|issue) is"
    r"|this (shows|proves|reminds) us that"
    r"|(in|to) (short|sum|summary|conclusion)"
    r"|ultimately,"
    r"|at the end of the day"
    r")\b"
)

# Second person, the thing AI writing almost never does.
_ADDRESSES_READER = re.compile(r"(?i)\b(you|your|yours|you're|you'll|you've)\b")

# A real counter-case rather than a single track where every example agrees.
_COUNTER_CASE = re.compile(
    r"(?i)\b("
    r"however|although|though|whereas|by contrast|on the other hand"
    r"|critics?|sceptics?|skeptics?|the objection|one objection"
    r"|that said|admittedly|granted|the exception|counterexample"
    r")\b"
)

# Hedges that admit the writer does not know, as opposed to stacked qualifiers
# that hedge a claim into meaninglessness.
_ADMITS_UNCERTAINTY = re.compile(
    r"(?i)\b("
    r"we (do not|don't) know|it (is|'s) (still )?unclear|no one knows"
    r"|remains? (an )?open question|hard to say|the evidence is (thin|mixed)"
    r"|i (do not|don't) know|too early to (say|tell)"
    r")\b"
)

# Something a reader could check: a figure, a year, a percentage, a named
# product or organisation.
_NUMBER = re.compile(r"(?<![A-Za-z])\d[\d,.]*\s*(%|percent|x|ms|s\b|k\b|m\b|bn\b)?")
_YEAR = re.compile(r"\b(19|20)\d{2}\b")
# Quantities are as often written out as digitised — "a thousand transactions
# per second" is exactly as checkable as "1,000". Missing these cost a real
# draft fifteen points for having no specifics when it had one.
_SPELLED_NUMBER = re.compile(
    r"(?i)\b("
    r"one|two|three|four|five|six|seven|eight|nine|ten"
    r"|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    r"|hundred|thousand|million|billion|trillion|dozen"
    r"|half|third|quarter|double|triple"
    r")\b"
)
# Two or more capitalised words in a row, not at the start of a sentence.
_PROPER_NOUN = re.compile(r"(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+")

_SENTENCES = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[A-Za-z0-9'’-]+")
_FINAL_PARAGRAPH = re.compile(r"\n\s*\n")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCES.split(text) if s.strip()]


def read_features(text: str) -> dict:
    """The six structural behaviours, as booleans and rates."""
    sentences = _sentences(text)
    words = _WORD.findall(text)
    word_count = len(words) or 1

    paragraphs = [p.strip() for p in _FINAL_PARAGRAPH.split(text) if p.strip()]
    closing = paragraphs[-1] if paragraphs else text

    # Only the closing counts for the self-explaining check. A piece may name
    # its subject anywhere; the tell is ending by explaining what it meant.
    explains_itself = bool(_STATES_ITS_MEANING.search(closing))

    reader_hits = len(_ADDRESSES_READER.findall(text))
    specifics = (
        len(_NUMBER.findall(text))
        + len(_YEAR.findall(text))
        + len(_SPELLED_NUMBER.findall(text))
        + len(_PROPER_NOUN.findall(text))
    )

    return {
        "explains_its_own_meaning": explains_itself,
        "addresses_reader": reader_hits > 0,
        "reader_address_per_100": round(reader_hits / word_count * 100, 2),
        "holds_a_counter_case": bool(_COUNTER_CASE.search(text)),
        "admits_uncertainty": bool(_ADMITS_UNCERTAINTY.search(text)),
        "names_specifics": specifics > 0,
        "specifics_per_100": round(specifics / word_count * 100, 2),
        "words": word_count,
        "sentences": len(sentences),
    }


# How much each behaviour moves the score. Deductions are larger than credits
# on purpose: a piece that does nothing wrong should sit near the top, and the
# credits are there to distinguish genuinely reader-aware writing from writing
# that is merely inoffensive.
_DEDUCT_EXPLAINS_ITSELF = 15
_DEDUCT_NO_SPECIFICS = 15
_DEDUCT_SINGLE_TRACK = 10
_CREDIT_ADDRESSES_READER = 6
_CREDIT_ADMITS_UNCERTAINTY = 4

# Tells cost up to this much. The density figure is the same one the evaluation
# corpus tracks, so the two move together.
_TELL_PENALTY_CAP = 25
_TELL_DENSITY_AT_CAP = 8.0

# Below this there is not enough text for the features to mean anything: a
# two-line post has no closing paragraph to speak of and no room for a
# counter-case. Scoring it would report noise.
MIN_WORDS = 60


def score(text: str) -> dict | None:
    """An advisory 0-100 writing score, with the reasons that produced it.

    Returns None for text too short to read structurally, rather than a number
    the caller would have no way to know was meaningless.
    """
    if not text or not text.strip():
        return None

    features = read_features(text)
    if features["words"] < MIN_WORDS:
        return None

    tells = tell_report(text)
    density = float(tells.get("per_100_words", 0.0))

    value = 100.0
    reasons: list[str] = []

    if features["explains_its_own_meaning"]:
        value -= _DEDUCT_EXPLAINS_ITSELF
        reasons.append(
            "The closing explains the piece's own meaning. AI writing does this "
            "77% of the time against 52% for people — trust the reader to take it."
        )

    if not features["names_specifics"]:
        value -= _DEDUCT_NO_SPECIFICS
        reasons.append(
            "Nothing a reader could check: no figure, date or named example."
        )

    if not features["holds_a_counter_case"]:
        value -= _DEDUCT_SINGLE_TRACK
        reasons.append(
            "The argument runs on a single track. Every example points the same "
            "way and no objection is entertained."
        )

    if features["addresses_reader"]:
        value += _CREDIT_ADDRESSES_READER
    else:
        reasons.append(
            "The piece never addresses the reader. People do this four times as "
            "often as models."
        )

    if features["admits_uncertainty"]:
        value += _CREDIT_ADMITS_UNCERTAINTY

    if density > 0:
        penalty = min(density / _TELL_DENSITY_AT_CAP, 1.0) * _TELL_PENALTY_CAP
        value -= penalty
        if penalty >= 5:
            reasons.append(
                f"{tells['effective_count']} writing tell(s) at "
                f"{density} per 100 words."
            )

    return {
        "score": int(round(max(0.0, min(100.0, value)))),
        "features": features,
        "tell_density": density,
        "tell_counts": tells.get("counts", {}),
        "reasons": reasons,
        # Said plainly so nothing downstream mistakes this for a gate.
        "advisory": True,
    }
