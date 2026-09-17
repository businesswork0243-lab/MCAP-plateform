"""Deterministic detection of AI writing tells, reported as spans.

Why spans and not counts: the humanizer can only fix what it can see. Telling a
model "you used a forced triad somewhere" produces a guess; handing it the exact
sentence produces an edit. Every detector here returns the offending text with
its offsets so the prompt can quote it back.

Why regex and not an LLM: the rule engine's judgement is LLM-based, and when
that call failed it used to mark everything clean. These run for free, in
microseconds, and keep working during an outage.

Pattern taxonomy and the strong/weak-alone distinction are adapted from
blader/humanizer (MIT licence), which is itself built on Wikipedia's
"Signs of AI writing". See docs/PATTERNS.md for attribution.

`text_cleaner.py` keeps its existing API untouched; three call sites depend on
it. This module is additive.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Iterable

# ─── Strength ─────────────────────────────────────────────────────────────────
# STRONG   — a careful writer would rarely do this on purpose. One sighting counts.
# WEAK     — legitimate in ordinary writing. Counts only with company (see below).

STRONG = "strong"
WEAK = "weak"


@dataclass
class Tell:
    id: str
    number: str          # the pattern number in the taxonomy
    name: str
    strength: str
    match: str
    start: int
    end: int

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "number": self.number,
            "name": self.name,
            "strength": self.strength,
            "match": self.match,
            "start": self.start,
            "end": self.end,
        }


@dataclass
class Pattern:
    id: str
    number: str
    name: str
    strength: str
    regexes: list[str] = field(default_factory=list)
    finder: Callable[[str], Iterable[tuple[int, int, str]]] | None = None
    # A weak pattern needs this many hits on its own before it counts at all.
    solo_threshold: int = 2


# ─── Helpers ──────────────────────────────────────────────────────────────────

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_CODE_SPAN = re.compile(r"`[^`]*`|```.*?```", re.S)


def _paragraphs(text: str) -> list[tuple[int, str]]:
    """Paragraphs with their start offset."""
    out, pos = [], 0
    for block in text.split("\n\n"):
        if block.strip():
            out.append((pos, block))
        pos += len(block) + 2
    return out


def _sentences(block: str) -> list[tuple[int, str]]:
    out, pos = [], 0
    for s in _SENTENCE_SPLIT.split(block):
        if s.strip():
            idx = block.find(s, pos)
            out.append((idx, s.strip()))
            pos = idx + len(s)
    return out


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def _protected_spans(text: str) -> list[tuple[int, int]]:
    """Code, inline code and URLs are not prose; never flag inside them."""
    spans = [(m.start(), m.end()) for m in _CODE_SPAN.finditer(text)]
    spans += [(m.start(), m.end()) for m in re.finditer(r"https?://\S+", text)]
    return spans


def _is_protected(start: int, spans: list[tuple[int, int]]) -> bool:
    return any(a <= start < b for a, b in spans)


# ─── Structural finders ───────────────────────────────────────────────────────

_CLOSER_PHRASES = re.compile(
    r"(?i)^(that('?s| is) (the real win|the point|it)|read that again|"
    r"let that sink in|and that changes everything|simple as that|"
    r"that('?s| is) the whole (point|story)|full stop|period\.)\W*$"
)


def _find_one_line_closers(text: str):
    """Pattern 2 — a paragraph that restates instead of adding.

    Two shapes: a known closer phrase standing alone, or a run of three or more
    very short fragments in one paragraph.
    """
    for offset, block in _paragraphs(text):
        stripped = block.strip()
        if _CLOSER_PHRASES.match(stripped):
            yield offset, offset + len(block), stripped[:90]
            continue

        sents = _sentences(stripped)
        if len(sents) >= 3:
            short = [s for _, s in sents if _word_count(s) <= 4]
            if len(short) >= 3:
                yield offset, offset + len(block), stripped[:90]


def _find_repeated_openings(text: str):
    """Pattern 7 — three or more consecutive sentences opening the same way."""
    for offset, block in _paragraphs(text):
        sents = _sentences(block)
        run_word, run_start, run = None, 0, 0
        for idx, sentence in sents:
            first = re.match(r"\b([\w']+)", sentence)
            word = first.group(1).lower() if first else ""
            if word and word == run_word:
                run += 1
                if run == 3:
                    yield offset + run_start, offset + idx + len(sentence), \
                        f"three sentences opening with '{word}'"
            else:
                run_word, run_start, run = word, idx, 1


def _find_triads(text: str):
    """Pattern 6 — 'A, B, and C' where all three are short parallel items."""
    triad = re.compile(
        r"\b([\w][\w '\-]{2,34}),\s+([\w][\w '\-]{2,34}),\s+and\s+([\w][\w '\-]{2,34})\b"
    )
    for m in triad.finditer(text):
        yield m.start(), m.end(), m.group(0)[:90]


def _find_dashes(text: str):
    """Pattern 8 — em/en dash or ' -- ' used as a connector."""
    for m in re.finditer(r"\s[—–]\s|\s--\s|\w[—–]\w", text):
        yield m.start(), m.end(), text[max(0, m.start() - 25):m.end() + 25].strip()[:90]


def _find_bold_labels(text: str):
    """Pattern 19 — bold used as a label on a list item.

    Both spellings occur: the colon inside the bold (`**Performance:**`) and
    outside it (`**Performance**:`).
    """
    label = re.compile(
        r"(?m)^\s*(?:[-*]\s+)?\*\*[^*\n]{2,40}(?::\*\*|\*\*\s*:)"
    )
    for m in label.finditer(text):
        yield m.start(), m.end(), m.group(0).strip()[:90]


def _find_decorative_headings(text: str):
    """Pattern 20 — emoji in a heading, or Title Case Applied To Every Word."""
    for m in re.finditer(r"(?m)^#{1,6}\s+(.+)$", text):
        heading = m.group(1).strip()
        has_emoji = bool(re.search(r"[\U0001F300-\U0001FAFF✀-➿]", heading))
        words = [w for w in heading.split() if len(w) > 3]
        title_case = len(words) >= 3 and all(w[0].isupper() for w in words)
        if has_emoji or title_case:
            yield m.start(), m.end(), heading[:90]


def _find_heading_echo(text: str):
    """Pattern 24 — the first sentence repeats the heading it sits under."""
    for m in re.finditer(r"(?m)^#{1,6}\s+(.+)$", text):
        heading_words = {
            w.lower() for w in re.findall(r"\b[\w']{4,}\b", m.group(1))
        }
        if not heading_words:
            continue
        rest = text[m.end():m.end() + 400].strip()
        first = _sentences(rest)[:1]
        if not first:
            continue
        sentence = first[0][1]
        body_words = {w.lower() for w in re.findall(r"\b[\w']{4,}\b", sentence)}
        if heading_words and len(heading_words & body_words) >= max(1, len(heading_words) // 2):
            yield m.end(), m.end() + len(sentence), sentence[:90]


# ─── The taxonomy ─────────────────────────────────────────────────────────────
# Numbers follow the humanizer taxonomy. Pattern 1 (not X but Y) and pattern 12
# (overused AI words) already live in text_cleaner and humanizer respectively,
# so they are not duplicated here.

PATTERNS: list[Pattern] = [
    Pattern(
        "TELL02", "2", "One-line closers and dramatic fragments", STRONG,
        finder=_find_one_line_closers,
    ),
    Pattern(
        "TELL03", "3", "Sayings that sound deep", STRONG,
        regexes=[
            r"(?i)\bthe real question is\b",
            r"(?i)\bat (its|the) core\b",
            r"(?i)\bwhat really matters\b",
            r"(?i)\bthe deeper (issue|truth|question)\b",
            r"(?i)\bthe heart of the matter\b",
            r"(?i)\bis the (language|currency|architecture|backbone) of\b",
            r"(?i)\bbecomes a trap\b",
            r"(?i)\bnot a tool but a\b",
        ],
    ),
    Pattern(
        "TELL04", "4", "Staged run-up before the point", STRONG,
        regexes=[
            r"(?i)\blet'?s (dive in|dive into|explore|break this down|be honest)\b",
            r"(?i)\bhere'?s what you need to know\b",
            r"(?i)\bwithout further ado\b",
            r"(?im)^(here'?s the thing|the thing is|real talk|look,|honestly\?)",
            r"(?i)\bnow let'?s look at\b",
        ],
    ),
    Pattern(
        "TELL05", "5", "Arguing with no one", STRONG,
        regexes=[
            r"(?i)\bthis isn'?t (mainly |really )?about\b",
            r"(?i)\bi'?m not saying\b",
            r"(?im)^to be clear,",
            r"(?i)\bdon'?t get me wrong\b",
            r"(?i)\bthis is not to say\b",
            r"(?i)\bsome might say\b",
            r"(?i)\ba tempting approach would be\b",
            r"(?i)\bone might be tempted to\b",
            r"(?i)\byou might think\b",
            r"(?i)\bit would be easy to just\b",
        ],
    ),
    Pattern(
        "TELL06", "6", "Forced triads", WEAK,
        finder=_find_triads, solo_threshold=2,
    ),
    Pattern(
        "TELL07", "7", "Repeated sentence openings", WEAK,
        finder=_find_repeated_openings, solo_threshold=1,
    ),
    Pattern(
        "TELL08", "8", "Dashes as the universal connector", WEAK,
        finder=_find_dashes, solo_threshold=3,
    ),
    Pattern(
        "TELL09", "9", "Stacked qualifiers", WEAK,
        regexes=[
            r"(?i)\bcould potentially\b",
            r"(?i)\bmight arguably\b",
            r"(?i)\bit'?s also possible\b",
            r"(?i)\bin some cases it may\b",
            r"(?i)\bto be fair\b",
            r"(?i)\bthis is an inference\b",
        ],
        solo_threshold=2,
    ),
    Pattern(
        "TELL10", "10", "Hyphenated pairs everywhere", WEAK,
        regexes=[
            r"(?i)\b(is|are|was|were|feels?|seems?|remains?)\s+"
            r"(third-party|cross-functional|client-facing|data-driven|"
            r"decision-making|well-known|high-quality|real-time|long-term|end-to-end)\b",
        ],
        solo_threshold=2,
    ),
    Pattern(
        "TELL11", "11", "Passive voice and missing subjects", WEAK,
        regexes=[
            r"(?im)^no \w+ (needed|required)\.?$",
            r"(?i)\b(is|are|was|were|been|being)\s+\w+ed\s+(by|automatically)\b",
        ],
        solo_threshold=3,
    ),
    Pattern(
        "TELL13", "13", "Inflated significance", STRONG,
        regexes=[
            r"(?i)\bstands? as a testament\b",
            r"(?i)\ba (pivotal|crucial|defining) moment\b",
            r"(?i)\bplays? a (key|vital|crucial) role\b",
            r"(?i)\bmarking a (new|significant|pivotal)\b",
            r"(?i)\bunderscores? (its|the) (importance|significance)\b",
            r"(?i)\breflects? a broader\b",
            r"(?i)\b(enduring|lasting) legacy\b",
            r"(?i)\bsetting the stage for\b",
            r"(?i)\bevolving landscape\b",
            r"(?i)\bindelible mark\b",
            r"(?i)\bcontinues to thrive\b",
            r"(?i)\bthe future looks bright\b",
            r"(?i)\bexciting times (ahead|lie ahead)\b",
            r"(?i)\ba step in the right direction\b",
        ],
    ),
    Pattern(
        "TELL14", "14", "Vague connection or association", STRONG,
        regexes=[
            r"(?i)\b(is|was|are|were|been)\s+associated with\b",
            r"(?i)\bin association with\b",
            r"(?i)\bin connection (with|to)\b",
            r"(?i)\b(is|was|are|were)\s+(connected|linked|tied) to\b",
        ],
    ),
    Pattern(
        "TELL15", "15", "Shallow -ing riders", STRONG,
        regexes=[
            r",\s+(?i:highlighting|underscoring|emphasizing|emphasising|ensuring|"
            r"reflecting|symbolizing|symbolising|showcasing|fostering|cultivating|"
            r"encompassing|contributing to)\b",
        ],
    ),
    Pattern(
        "TELL16", "16", "Sales language", STRONG,
        regexes=[
            r"(?i)\bboasts?\b",
            r"(?i)\bnestled\b",
            r"(?i)\bin the heart of\b",
            r"(?i)\b(breathtaking|stunning|must-visit|renowned|groundbreaking)\b",
            r"(?i)\bdiverse array\b",
            r"(?i)\bcommitment to excellence\b",
            r"(?i)\bexemplifies\b",
        ],
    ),
    Pattern(
        "TELL17", "17", "Borrowed authority", STRONG,
        regexes=[
            r"(?i)\bexperts (argue|believe|say|agree)\b",
            r"(?i)\bobservers have (cited|noted)\b",
            r"(?i)\bindustry reports (show|suggest)\b",
            r"(?i)\bsome critics\b",
            r"(?i)\bstudies show\b",
            r"(?i)\bresearch (proves|shows) that\b",
            r"(?i)\baccording to experts\b",
            r"(?i)\bactive social media presence\b",
        ],
    ),
    Pattern(
        "TELL18", "18", "Avoiding is, are and has", WEAK,
        regexes=[
            r"(?i)\b(serves|stands|functions|operates) as\b",
            r"(?i)\brepresents a\b",
            r"(?i)\brefers to\b",
        ],
        solo_threshold=2,
    ),
    Pattern(
        "TELL19", "19", "Bold as decoration", WEAK,
        finder=_find_bold_labels, solo_threshold=2,
    ),
    Pattern(
        "TELL20", "20", "Decorative headings", WEAK,
        finder=_find_decorative_headings, solo_threshold=1,
    ),
    Pattern(
        "TELL21", "21", "Curly quotation marks", WEAK,
        regexes=[r"[“”‘’]"],
        solo_threshold=4,
    ),
    Pattern(
        "TELL22", "22", "Chatbot residue", STRONG,
        regexes=[
            r"(?i)\bgreat question\b",
            r"(?i)\bi hope this helps\b",
            r"(?im)^(certainly|sure)[!,]",
            r"(?i)\bas an ai\b",
            r"(?i)\bhere'?s a (draft|version) (of|for) you\b",
            r"(?i)\blet me know if you\b",
        ],
    ),
    Pattern(
        "TELL23", "23", "Knowledge-limit disclaimers", STRONG,
        regexes=[
            r"(?i)\bwhile (details|information) (are|is) limited\b",
            r"(?i)\bavailable sources (suggest|indicate)\b",
            r"(?i)\bas of my last (update|training)\b",
            r"(?i)\bit appears that\b",
        ],
    ),
    Pattern(
        "TELL24", "24", "Heading repeated in the first sentence", WEAK,
        finder=_find_heading_echo, solo_threshold=2,
    ),
]

PATTERNS_BY_ID = {p.id: p for p in PATTERNS}


# ─── Detection ────────────────────────────────────────────────────────────────

def find_tells(text: str) -> list[dict]:
    """Every tell in the text, as spans, ordered by position."""
    if not text or not text.strip():
        return []

    protected = _protected_spans(text)
    found: list[Tell] = []

    for pattern in PATTERNS:
        for rx in pattern.regexes:
            for m in re.finditer(rx, text):
                if _is_protected(m.start(), protected):
                    continue
                found.append(Tell(
                    pattern.id, pattern.number, pattern.name, pattern.strength,
                    m.group(0).strip()[:90], m.start(), m.end(),
                ))
        if pattern.finder:
            for start, end, snippet in pattern.finder(text):
                if _is_protected(start, protected):
                    continue
                found.append(Tell(
                    pattern.id, pattern.number, pattern.name, pattern.strength,
                    snippet, start, end,
                ))

    found.sort(key=lambda t: t.start)
    return [t.as_dict() for t in found]


def tell_report(text: str) -> dict:
    """Tells plus the density figure the evaluation corpus tracks.

    Weak patterns only count toward `effective` when they have company: either
    the pattern clears its own solo threshold, or two different weak patterns
    appear in the same piece. A single dash is a writing choice; nine dashes and
    three triads is a machine.
    """
    tells = find_tells(text)
    words = _word_count(text)

    counts: dict[str, int] = {}
    for t in tells:
        counts[t["id"]] = counts.get(t["id"], 0) + 1

    strong = [t for t in tells if t["strength"] == STRONG]
    weak_ids = {t["id"] for t in tells if t["strength"] == WEAK}

    effective = list(strong)
    for pid in weak_ids:
        pattern = PATTERNS_BY_ID[pid]
        hits = counts[pid]
        if hits >= pattern.solo_threshold or len(weak_ids) >= 2:
            effective += [t for t in tells if t["id"] == pid]

    per_100 = round(len(effective) / words * 100, 2) if words else 0.0

    return {
        "tells": tells,
        "counts": counts,
        "strong_count": len(strong),
        "weak_count": len(tells) - len(strong),
        "effective_count": len(effective),
        "words": words,
        "per_100_words": per_100,
    }


def format_for_prompt(text: str, limit: int = 12) -> str:
    """The offending sentences, written for a rewrite prompt.

    Naming the sentence is the point: a model told "you used a forced triad"
    guesses which one, a model shown the triad fixes it.
    """
    report = tell_report(text)
    if not report["tells"]:
        return ""

    lines = []
    seen: set[tuple[str, str]] = set()
    for t in report["tells"]:
        key = (t["id"], t["match"])
        if key in seen:
            continue
        seen.add(key)
        lines.append(f'  - {t["name"]}: "{t["match"]}"')
        if len(lines) >= limit:
            break

    return "PATTERNS FOUND IN THIS DRAFT (fix each one):\n" + "\n".join(lines)
