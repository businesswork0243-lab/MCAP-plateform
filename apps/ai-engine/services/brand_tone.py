"""Turn a brand's tone sliders into instructions a writer can follow.

The sliders (formality, confidence, humor ...) used to reach only the brand
optimizer and the humanizer, which run after the draft exists and are told to
leave a passage alone when it already sounds acceptable. A casual, witty brand
therefore got an analyst's draft, and every later stage agreed with it. The
writer is the stage that can set the register, so it needs the sliders too.

Pure string work, no model call.
"""
from __future__ import annotations

# Brand pages store sliders on a 0-10 scale. 4-6 is the unmarked middle, which
# produces no instruction at all: saying "be moderately formal" changes nothing.
_RULES: tuple[tuple[str, int, str, int, str], ...] = (
    # key, low cut-off, text at or below it, high cut-off, text at or above it
    ("formality", 3,
     "Casual and conversational. Contractions, plain words, and the way a person would say it out loud.",
     7,
     "Formal and precise. No contractions, no slang, complete sentences."),
    ("confidence", 3,
     "Measured and open. Hedge where the evidence is thin.",
     7,
     "Assertive and declarative. State the point; do not hedge it."),
    ("technical", 3,
     "Plain language. Explain any term a newcomer would not know.",
     7,
     "Technically deep. Assume an expert reader and skip the basics."),
    ("humor", 0,
     "",
     6,
     "Light humor and wit are welcome: one dry or playful turn where it fits, never at the reader's expense."),
    ("enthusiasm", 3,
     "Calm and understated.",
     7,
     "Energetic and warm. Let genuine excitement show in word choice."),
    ("empathy", 0,
     "",
     6,
     "Acknowledge the reader's situation before advising them."),
    ("storytelling", 3,
     "Direct and expository.",
     7,
     "Narrative. Prefer a concrete scene or moment over an abstract statement."),
)


def describe(tone: dict | None) -> str:
    """Binding tone instructions for the sliders that are set off-centre."""
    if not isinstance(tone, dict):
        return ""

    values: dict[str, float] = {}
    for key, value in tone.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values[str(key).lower()] = float(value)

    lines: list[str] = []
    for key, low, low_text, high, high_text in _RULES:
        if key not in values:
            continue
        v = values[key]
        if low_text and v <= low:
            lines.append(f"- {key.capitalize()} {v:g}/10: {low_text}")
        elif v >= high:
            lines.append(f"- {key.capitalize()} {v:g}/10: {high_text}")

    if not lines:
        return ""
    return (
        "BRAND TONE (binding; this is how the brand sounds):\n"
        + "\n".join(lines)
        + "\nSet the register from the first sentence. Do not write in a neutral analyst voice "
        "and leave the tone for a later edit."
        "\nTone is register only. A casual or energetic voice never licenses an invented "
        "story, a first-person experience, a past action of the brand or an assumption about the "
        "reader that the brand material does not state. Build the voice from word choice, rhythm and "
        "direct address, and keep every fact and claim to what the verified material supports."
    )


# ── Measured tone ─────────────────────────────────────────────────────────────
# A tone slider is an instruction, and a model that is told to leave sentences
# alone will read "casual" and change nothing. What can be checked is checked
# here: the signs of a register that are countable.

import re

_CONTRACTION = re.compile(
    r"(?i)\b\w+n['’]t\b|\b(?:i|you|we|they|it|that|there|here|what|who|he|she|let)['’](?:s|re|ve|ll|d|m)\b"
)
_YOU = re.compile(r"(?i)\b(?:you|your|yours|you're|you've|you'll|yourself)\b")
_WORD = re.compile(r"[\w'’-]+")

# Below this a piece is too short for a rate to mean anything.
_MIN_WORDS = 60
_CASUAL_CONTRACTIONS_PER_100 = 0.8
_CASUAL_ADDRESS_PER_100 = 0.5
_FORMAL_CONTRACTIONS_PER_100 = 0.3


def signs(text: str) -> dict:
    words = len(_WORD.findall(text))
    per = (lambda n: round(n / words * 100, 2)) if words else (lambda n: 0.0)
    return {
        "words": words,
        "contractions_per_100": per(len(_CONTRACTION.findall(text))),
        "address_per_100": per(len(_YOU.findall(text))),
    }


def gaps(text: str, tone: dict | None) -> list[tuple[str, str]]:
    """Where the text's measurable register contradicts the tone sliders.

    Each gap is (code, instruction). The code says whether code can close it.
    """
    if not isinstance(tone, dict) or not text:
        return []
    s = signs(text)
    if s["words"] < _MIN_WORDS:
        return []
    formality = tone.get("formality")
    if not isinstance(formality, (int, float)):
        return []
    out: list[tuple[str, str]] = []
    if formality <= 3:
        if s["contractions_per_100"] < _CASUAL_CONTRACTIONS_PER_100:
            out.append((
                "contractions",
                "It uses almost no contractions. Write it the way a person speaks: "
                "it's, don't, here's, that's, we're, wherever it reads naturally.",
            ))
        if s["address_per_100"] < _CASUAL_ADDRESS_PER_100:
            out.append((
                "address",
                "It never speaks to the reader. Address them directly with you or your, "
                "in the opening and again in the body.",
            ))
    elif formality >= 7 and s["contractions_per_100"] > _FORMAL_CONTRACTIONS_PER_100:
        out.append(("expand", "It uses contractions. Write them out in full: it is, do not, that is."))
    return out


# Contractions are a register change that touches no fact, so code makes them.
# A model told to leave sentences alone, given a formal draft for a casual
# brand, returned zero contractions even when asked for them by name.
_PAIRS = (
    ("do not", "don't"), ("does not", "doesn't"), ("did not", "didn't"), ("is not", "isn't"),
    ("are not", "aren't"), ("was not", "wasn't"), ("were not", "weren't"), ("has not", "hasn't"),
    ("have not", "haven't"), ("will not", "won't"), ("cannot", "can't"), ("could not", "couldn't"),
    ("would not", "wouldn't"), ("should not", "shouldn't"), ("it is", "it's"), ("that is", "that's"),
    ("there is", "there's"), ("here is", "here's"), ("we are", "we're"), ("you are", "you're"),
    ("they are", "they're"),
)
_FULL_TO_SHORT = [(re.compile(r"(?i)\b" + re.escape(full) + r"\b"), short) for full, short in _PAIRS]
_SHORT_TO_FULL = [(re.compile(r"(?i)\b" + re.escape(short) + r"\b"), full)
                  for full, short in _PAIRS if short != "can't"] + [(re.compile(r"(?i)\bcan't\b"), "cannot")]
_QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”')


def _match_case(src: str, repl: str) -> str:
    return repl[:1].upper() + repl[1:] if src[:1].isupper() else repl


def _outside_quotes(text: str, pattern, repl_for, limit: int | None) -> str:
    """Apply `pattern` outside quoted speech, hashtags and headings, at most `limit` times."""
    quoted = [(m.start(), m.end()) for m in _QUOTED.finditer(text)]
    heading = [(m.start(), m.end()) for m in re.finditer(r"(?m)^\s*#{1,6} .*$", text)]
    hits = [
        m for m in pattern.finditer(text)
        if not any(a <= m.start() < b for a, b in quoted + heading)
    ]
    if limit is not None and len(hits) > limit:
        step = len(hits) / limit
        hits = [hits[int(i * step)] for i in range(limit)]
    for m in reversed(hits):
        text = text[:m.start()] + _match_case(m.group(0), repl_for) + text[m.end():]
    return text


def contract(text: str) -> str:
    """Contract the full forms outside quotes, about one per 60 words, spread through the text."""
    budget = max(2, len(_WORD.findall(text)) // 60)
    for pattern, short in _FULL_TO_SHORT:
        if budget <= 0:
            break
        before = text
        text = _outside_quotes(text, pattern, short, 1)   # one of each form keeps it from reading mechanical
        if text != before:
            budget -= 1
    return text


def expand(text: str) -> str:
    """Write contractions out in full, outside quotes."""
    for pattern, full in _SHORT_TO_FULL:
        text = _outside_quotes(text, pattern, full, None)
    return text
