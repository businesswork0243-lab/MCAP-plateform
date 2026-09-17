# apps/ai-engine/agents/rule_engine/rules/tell_rules.py
"""Rule entries backed by the deterministic tell detectors.

These differ from the rest of STATIC_RULES in one important way: nothing here
asks an LLM for a verdict. `services.tells` finds the spans with regex, so the
validator marks them violated or passed without spending a call. That keeps the
cost of adding twenty-two patterns at zero and keeps them working during an
outage, when the LLM-judged rules go unverified.

Rule ids are written out rather than derived from list order. Once a piece of
content has been scored against SR023, that id has to keep meaning the same
thing, and reordering `PATTERNS` upstream must not silently renumber anything.
"""

from services.tells import PATTERNS, STRONG
from .rule_models import Rule, RuleType, RuleCategory, RuleSeverity


TELL_RULE_IDS: dict[str, str] = {
    "TELL02": "SR017",   # One-line closers and dramatic fragments
    "TELL03": "SR018",   # Sayings that sound deep
    "TELL04": "SR019",   # Staged run-up before the point
    "TELL05": "SR020",   # Arguing with no one
    "TELL06": "SR021",   # Forced triads
    "TELL07": "SR022",   # Repeated sentence openings
    "TELL08": "SR023",   # Dashes as the universal connector
    "TELL09": "SR024",   # Stacked qualifiers
    "TELL10": "SR025",   # Hyphenated pairs everywhere
    "TELL11": "SR026",   # Passive voice and missing subjects
    "TELL13": "SR027",   # Inflated significance
    "TELL14": "SR028",   # Vague connection or association
    "TELL15": "SR029",   # Shallow -ing riders
    "TELL16": "SR030",   # Sales language
    "TELL17": "SR031",   # Borrowed authority
    "TELL18": "SR032",   # Avoiding is, are and has
    "TELL19": "SR033",   # Bold as decoration
    "TELL20": "SR034",   # Decorative headings
    "TELL21": "SR035",   # Curly quotation marks
    "TELL22": "SR036",   # Chatbot residue
    "TELL23": "SR037",   # Knowledge-limit disclaimers
    "TELL24": "SR038",   # Heading repeated in the first sentence
}

# What the writer should do instead. The regeneration agent passes these
# through to the rewrite prompt, so they are phrased as instructions to a
# writer rather than as descriptions of the fault.
FIXES: dict[str, str] = {
    "TELL02": "Delete the dramatic one-line paragraph, or merge it into the "
              "paragraph it interrupts. If it was delaying a claim, make the claim.",
    "TELL03": "Cut the aphorism. Say the specific thing it was standing in for.",
    "TELL04": "Open with the fact or claim itself. Remove the sentence that "
              "announces that something important is coming.",
    "TELL05": "Remove the imagined objection. Nobody in the text disagreed.",
    "TELL06": "Collapse the three-part list to the items that carry meaning. "
              "Two is usually enough; one is often better.",
    "TELL07": "Vary how consecutive sentences start.",
    "TELL09": "Pick one qualifier or none. Stacked hedges read as uncertainty "
              "about whether the claim is true.",
    "TELL08": "Replace the dash with a comma, a full stop or a colon, whichever "
              "the sentence actually needs.",
    "TELL10": "Use the plain word instead of the hyphenated compound.",
    "TELL11": "Name who did it. Passive voice hides the actor.",
    "TELL13": "Drop the significance claim and state what happened. Let the "
              "reader judge whether it matters.",
    "TELL14": "Say what the relationship actually is, or cut the sentence.",
    "TELL15": "Turn the trailing -ing clause into its own sentence, or delete it "
              "if it only restates the main clause.",
    "TELL16": "Remove the sales framing. State the fact.",
    "TELL17": "Name the source, or drop the appeal to unnamed authority.",
    "TELL18": "Use is, are or has where that is the plain verb.",
    "TELL19": "Remove decorative bold. Keep bold for genuine emphasis only.",
    "TELL20": "Give the heading the content's own words, or remove it.",
    "TELL21": "Use straight quotation marks.",
    "TELL22": "Delete the conversational residue. This is published content, "
              "not a reply.",
    "TELL23": "Remove the disclaimer about limited information. Either the claim "
              "is supported by the brand material or it does not belong.",
    "TELL24": "Do not repeat the heading in the sentence beneath it.",
}

# Style rules deliberately weigh less than grounding. A dash is a matter of
# taste; an invented job title is not. Total added weight is about 0.5 against
# the existing 1.82, so tells move the score without dominating it.
STRONG_WEIGHT = 0.03
WEAK_WEIGHT = 0.015


def _build() -> list[Rule]:
    rules: list[Rule] = []
    for pattern in PATTERNS:
        rule_id = TELL_RULE_IDS.get(pattern.id)
        if not rule_id:
            # A pattern added upstream without an id assigned here is skipped
            # rather than auto-numbered, which would shift every id after it.
            continue

        is_strong = pattern.strength == STRONG
        rules.append(Rule(
            id=rule_id,
            type=RuleType.STATIC,
            category=RuleCategory.AI_PATTERNS,
            severity=RuleSeverity.MEDIUM if is_strong else RuleSeverity.LOW,
            name=pattern.name,
            description=(
                f"Pattern {pattern.number} in the tell taxonomy "
                f"({'strong' if is_strong else 'weak-alone'})."
            ),
            instruction=FIXES.get(pattern.id, "Rewrite the flagged span."),
            weight=STRONG_WEIGHT if is_strong else WEAK_WEIGHT,
            deterministic=True,
        ))
    return rules


TELL_RULES: list[Rule] = _build()

RULE_ID_TO_TELL: dict[str, str] = {v: k for k, v in TELL_RULE_IDS.items()}


def get_tell_rules() -> list[Rule]:
    return TELL_RULES
