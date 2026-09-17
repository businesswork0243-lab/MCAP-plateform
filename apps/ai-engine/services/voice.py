"""Measure how a brand actually writes, from their own documents.

Until now every brand got the same instruction — "vary sentence rhythm" — which
is advice, not a target. A consultancy that writes in long qualified paragraphs
and a founder who writes in six-word lines were told the same thing and drifted
toward the same middle.

This reads the brand's uploaded document and reports what their writing does:
how long their sentences run, how much that length varies, whether they use
first person, whether they ask questions, how often they reach for a dash. The
writer then has a number to hit instead of an adjective to interpret.

Nothing here calls a model. It is arithmetic over the text, so it costs nothing
and runs when the provider is down.

Deliberately not measured: vocabulary. Word choice is already handled by
preferred terms and banned phrases, and it is the layer that expires with each
model release. Rhythm persists.
"""
from __future__ import annotations

import re
import statistics

# A document shorter than this cannot support a rhythm measurement. Five
# sentences of someone's writing tells you about those five sentences. Handing
# the writer a target derived from them would be worse than handing it nothing,
# because it looks authoritative.
MIN_WORDS = 150
MIN_SENTENCES = 8

# The draft being compared is held to a lower bar than the document it is
# compared against. The document is the authority and has to be solid; the
# draft is a social post, and most of ours run 110-200 words. Mean sentence
# length and its spread are stable enough over eight sentences to compare,
# and refusing to measure them would make the match figure null on nearly
# every real piece — a feature that never fires.
DRAFT_MIN_WORDS = 80
DRAFT_MIN_SENTENCES = 6

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])[\s\n]+")
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
_WORD = re.compile(r"[A-Za-z0-9'’-]+")
_FIRST_PERSON = re.compile(r"(?i)\b(i|i'm|i've|i'll|my|me|we|we're|we've|our|us)\b")
_CONTRACTION = re.compile(r"(?i)\b\w+['’](s|t|re|ve|ll|d|m)\b")
_DASH = re.compile(r"[—–]|(?<=\w)\s-\s(?=\w)")

# Front matter and markdown scaffolding are ours, not the brand's. Measuring
# them would report our own formatting back to us as their voice.
_FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.S)
_MD_NOISE = re.compile(r"(?m)^(#{1,6}\s+|\s*[-*+]\s+|\s*\d+\.\s+|>\s?)")
_CODE_BLOCK = re.compile(r"```.*?```", re.S)


def _clean(text: str) -> str:
    text = _FRONT_MATTER.sub("", text)
    text = _CODE_BLOCK.sub(" ", text)
    text = _MD_NOISE.sub("", text)
    return text.strip()


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _words(text: str) -> list[str]:
    return _WORD.findall(text)


def measure(
    text: str | None,
    min_words: int = MIN_WORDS,
    min_sentences: int = MIN_SENTENCES,
) -> dict | None:
    """The brand's writing rhythm, or None when there is too little to measure.

    Returning None rather than a low-confidence profile is the point. A caller
    that gets None falls back to generic guidance, which is honest; a caller
    that gets a profile built from four sentences would state it to the model
    as fact.
    """
    if not text or not text.strip():
        return None

    cleaned = _clean(text)
    words = _words(cleaned)
    sentences = _sentences(cleaned)

    if len(words) < min_words or len(sentences) < min_sentences:
        return None

    lengths = [len(_words(s)) for s in sentences]
    lengths = [n for n in lengths if n > 0]
    if not lengths:
        return None

    paragraphs = [p for p in _PARAGRAPH_SPLIT.split(cleaned) if p.strip()]
    para_sentences = [len(_sentences(p)) for p in paragraphs] or [len(sentences)]

    word_total = len(words)
    sentence_total = len(lengths)

    return {
        "words": word_total,
        "sentences": sentence_total,

        # Rhythm
        "sentence_mean": round(statistics.fmean(lengths), 1),
        "sentence_median": round(statistics.median(lengths), 1),
        # Burstiness. A human's sentence lengths scatter; generated prose
        # clusters around its mean, which is what "all sentences same length"
        # actually means when measured.
        "sentence_stdev": round(
            statistics.pstdev(lengths) if len(lengths) > 1 else 0.0, 1
        ),
        "sentence_min": min(lengths),
        "sentence_max": max(lengths),
        "short_share": round(sum(1 for n in lengths if n <= 8) / sentence_total, 2),
        "long_share": round(sum(1 for n in lengths if n >= 25) / sentence_total, 2),

        # Shape on the page
        "paragraph_sentences": round(statistics.fmean(para_sentences), 1),

        # Habits, per 100 words so pieces of different lengths compare
        "first_person_per_100": round(
            len(_FIRST_PERSON.findall(cleaned)) / word_total * 100, 2
        ),
        "contractions_per_100": round(
            len(_CONTRACTION.findall(cleaned)) / word_total * 100, 2
        ),
        "dashes_per_100": round(
            len(_DASH.findall(cleaned)) / word_total * 100, 2
        ),
        "question_share": round(
            sum(1 for s in sentences if s.rstrip().endswith("?")) / sentence_total, 2
        ),
    }


def describe(profile: dict | None) -> str:
    """The profile as a rhythm target a writer can act on.

    Phrased as observations about the brand rather than commands, because the
    piece being written is not the document being measured — a target of 18
    words per sentence is a centre of gravity, not a rule for every line.
    """
    if not profile:
        return ""

    lines = [
        f"  - Sentences average {profile['sentence_mean']} words "
        f"(shortest {profile['sentence_min']}, longest {profile['sentence_max']}).",
    ]

    stdev = profile["sentence_stdev"]
    if stdev >= 8:
        lines.append(
            f"  - Length varies widely (spread {stdev}). Mix short lines with long ones; "
            "do not settle into an even rhythm."
        )
    elif stdev <= 4:
        lines.append(
            f"  - Length stays even (spread {stdev}). Keep sentences close to the average."
        )
    else:
        lines.append(f"  - Moderate variation in length (spread {stdev}).")

    if profile["short_share"] >= 0.25:
        lines.append(
            f"  - {int(profile['short_share'] * 100)}% of sentences are eight words or fewer. "
            "Short lines are part of this voice."
        )
    if profile["long_share"] >= 0.2:
        lines.append(
            f"  - {int(profile['long_share'] * 100)}% run past 25 words. "
            "Long, qualified sentences belong here."
        )

    lines.append(
        f"  - Paragraphs run about {profile['paragraph_sentences']} sentences."
    )

    fp = profile["first_person_per_100"]
    if fp >= 2.0:
        lines.append(f"  - Writes in first person ({fp} per 100 words). Use I and we.")
    elif fp <= 0.3:
        lines.append("  - Avoids first person. Keep the writing impersonal.")

    con = profile["contractions_per_100"]
    if con >= 1.0:
        lines.append(f"  - Uses contractions ({con} per 100 words).")
    elif con == 0:
        lines.append("  - Never uses contractions. Write them out in full.")

    if profile["question_share"] >= 0.08:
        lines.append(
            f"  - Asks questions ({int(profile['question_share'] * 100)}% of sentences)."
        )

    dash = profile["dashes_per_100"]
    if dash <= 0.2:
        lines.append("  - Rarely uses dashes. Prefer commas and full stops.")
    else:
        lines.append(f"  - Uses dashes sparingly ({dash} per 100 words) — do not exceed this.")

    return "THIS BRAND'S MEASURED WRITING RHYTHM:\n" + "\n".join(lines)


# How large a gap has to be before that measurement counts as fully unlike the
# brand. Expressed as a tolerance rather than a multiplier so each term is
# scored on its own scale: eight words of average sentence length is a
# different voice, but eight dashes per hundred words is a different species.
#
# Scaling these wrong is not a cosmetic problem. An earlier version multiplied
# raw gaps by small weights and averaged, which scored two plainly different
# voices at 98.5% — a green badge on mismatched writing, worse than showing
# nothing at all.
_DISTANCE_TOLERANCE = {
    "sentence_mean": 8.0,
    "sentence_stdev": 6.0,
    "paragraph_sentences": 2.0,
    "first_person_per_100": 2.0,
    "contractions_per_100": 2.0,
    "dashes_per_100": 1.5,
}


def distance(profile: dict | None, text: str) -> dict | None:
    """How far a draft sits from the brand's measured rhythm.

    Reported, never enforced. A post is not a white paper, and a piece that
    matches a brand document exactly would be the wrong length for LinkedIn.
    This says how close the writing sits, and leaves the judgement to a person.
    """
    if not profile:
        return None

    draft = measure(text, DRAFT_MIN_WORDS, DRAFT_MIN_SENTENCES)
    if not draft:
        # Below even the lower bar there is nothing to compare — a three-line
        # post has no rhythm, only three lines.
        return None

    gaps: dict[str, float] = {}
    shares: list[float] = []
    for key, tolerance in _DISTANCE_TOLERANCE.items():
        gap = abs(draft.get(key, 0) - profile.get(key, 0))
        gaps[key] = round(gap, 2)
        # Capped at 1: past the tolerance the measurement is simply unlike the
        # brand, and how much further does not add information.
        shares.append(min(gap / tolerance, 1.0))

    match = round(max(0.0, 100.0 * (1.0 - statistics.fmean(shares))), 1)

    # The measurements that pushed the number down, worst first, so the report
    # says what to change rather than only how far off it is.
    worst = sorted(
        _DISTANCE_TOLERANCE,
        key=lambda k: gaps[k] / _DISTANCE_TOLERANCE[k],
        reverse=True,
    )
    return {
        "match": match,
        "gaps": gaps,
        "furthest": [k for k in worst if gaps[k] / _DISTANCE_TOLERANCE[k] >= 0.34][:3],
        "draft": draft,
    }
