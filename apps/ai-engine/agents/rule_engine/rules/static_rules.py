# apps/ai-engine/agents/rule_engine/rules/static_rules.py

from .rule_models import Rule, RuleType, RuleCategory, RuleSeverity


STATIC_RULES: list[Rule] = [

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 0 — FALSE NEGATIVES (CRITICAL — checked first always)
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR000",
        type=RuleType.STATIC,
        category=RuleCategory.FALSE_NEGATIVE,
        severity=RuleSeverity.CRITICAL,
        name="Zero False Negatives",
        description=(
            "Content must contain ZERO false negative constructions. "
            "A false negative states what something is NOT before saying what it IS. "
            "This is the #1 AI writing tell and must be completely eliminated."
        ),
        instruction=(
            "Scan the ENTIRE content for these EXACT patterns and flag EVERY instance:\n"
            "\n"
            "FORBIDDEN PATTERNS:\n"
            "  1. 'It's not just X, it's Y'\n"
            "  2. 'This isn't just about X, it's about Y'\n"
            "  3. 'It's not merely X, it's Y'\n"
            "  4. 'Not only does it X, but it also Y'\n"
            "  5. 'More than just X'\n"
            "  6. 'Far from being X'\n"
            "  7. 'Rather than being X, it's Y'\n"
            "  8. 'This isn't your typical X'\n"
            "  9. 'It's less about X and more about Y'\n"
            " 10. 'Not a X, but a Y'\n"
            " 11. 'Not about X, it's about Y'\n"
            " 12. 'Isn't just about'\n"
            " 13. 'Not just about'\n"
            " 14. 'More than just'\n"
            " 15. 'Not merely'\n"
            "\n"
            "If ANY of these patterns appear even once — rule is VIOLATED.\n"
            "Quote the EXACT sentence in 'location'."
        ),
        weight=0.25,
        examples={
            "bad_1":  "Blockchain isn't just about crypto, it's about trust.",
            "good_1": "Blockchain builds trust through cryptography.",
            "bad_2":  "Not only does it scale, but it also secures.",
            "good_2": "It scales and secures simultaneously.",
            "bad_3":  "This is more than just a feature.",
            "good_3": "This feature drives the entire strategy.",
            "bad_4":  "It's not merely a tool, it's a mindset.",
            "good_4": "It requires a fundamental mindset shift.",
        }
    ),

    Rule(
        id="SR001",
        type=RuleType.STATIC,
        category=RuleCategory.FALSE_NEGATIVE,
        severity=RuleSeverity.CRITICAL,
        name="No Contrast Negation",
        description=(
            "Eliminate 'not X but Y' contrast negation patterns. "
            "These are indirect and weak — always prefer direct positive statements."
        ),
        instruction=(
            "Check for these contrast negation patterns:\n"
            "  - 'not X, but Y' (e.g., 'not a cost, but an investment')\n"
            "  - 'less X, more Y' (e.g., 'less about features, more about experience')\n"
            "  - 'not X — Y' (with em-dash as separator)\n"
            "  - 'forget X, think Y'\n"
            "  - 'instead of X, think Y'\n"
            "  - 'rather than X, Y'\n"
            "\n"
            "If found, mark VIOLATED and quote exact sentence in 'location'."
        ),
        weight=0.15,
        examples={
            "bad":  "It's not a cost, it's an investment.",
            "good": "It pays for itself within a quarter.",
        }
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 1 — HALLUCINATION PREVENTION (CRITICAL)
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR002",
        type=RuleType.STATIC,
        category=RuleCategory.HALLUCINATION,
        severity=RuleSeverity.CRITICAL,
        name="No Fabricated Statistics",
        description="Content must not contain made-up or unverifiable statistics.",
        instruction=(
            "Check for suspicious statistics that appear fabricated:\n"
            "  - Overly specific percentages without source (e.g., '73.6% of users')\n"
            "  - Precise dollar figures with no attribution\n"
            "  - 'Studies show...' without naming the study\n"
            "  - 'Research proves...' without citation\n"
            "  - 'According to experts...' with no named expert\n"
            "\n"
            "Flag any statistic that looks invented or unverifiable."
        ),
        weight=0.15,
        examples={
            "bad":  "Studies show 87.3% of marketers prefer this approach.",
            "good": "Many marketers have shifted to this approach.",
        }
    ),

    Rule(
        id="SR003",
        type=RuleType.STATIC,
        category=RuleCategory.HALLUCINATION,
        severity=RuleSeverity.CRITICAL,
        name="No False Attributions",
        description="Do not falsely attribute quotes to real people or organizations.",
        instruction=(
            "Check if any quotes are attributed to real individuals or brands.\n"
            "Look for: 'As [Person] said...', '[Famous Person] once noted...'\n"
            "Unless the quote was explicitly provided in the input context,\n"
            "flag any attributed quote as a potential false attribution."
        ),
        weight=0.12,
        examples={
            "bad":  "As Steve Jobs said, 'Content is king.'",
            "good": "Great content, like great design, prioritizes the user.",
        }
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 2 — AI PATTERN DETECTION (HIGH)
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR004",
        type=RuleType.STATIC,
        category=RuleCategory.AI_PATTERNS,
        severity=RuleSeverity.HIGH,
        name="No AI Signature Phrases",
        description="Content must not contain phrases typical of AI-generated text.",
        instruction=(
            "Check for these AI signature phrases — flag if 3+ are present:\n"
            "\n"
            "Opening clichés:\n"
            "  - 'In today's fast-paced world'\n"
            "  - 'In today's rapidly evolving landscape'\n"
            "  - 'In an era of'\n"
            "  - 'In the age of'\n"
            "  - 'It is important to note'\n"
            "  - 'It's worth noting that'\n"
            "  - 'It goes without saying'\n"
            "  - 'Needless to say'\n"
            "  - 'When it comes to'\n"
            "  - 'At its core'\n"
            "  - 'At the heart of'\n"
            "\n"
            "AI enthusiasm tells:\n"
            "  - 'Certainly!', 'Absolutely!', 'Great question!'\n"
            "  - 'Excited to share', 'Thrilled to announce'\n"
            "  - 'Delve into', 'Deep dive', 'Dive deep'\n"
            "\n"
            "Generic transitions:\n"
            "  - 'In conclusion', 'To summarize', 'In summary'\n"
            "  - 'Furthermore', 'Moreover', 'Additionally'\n"
            "  - 'That being said', 'With that in mind'\n"
            "\n"
            "VIOLATED if 3 or more of these appear in the content."
        ),
        weight=0.10,
    ),

    Rule(
        id="SR005",
        type=RuleType.STATIC,
        category=RuleCategory.AI_PATTERNS,
        severity=RuleSeverity.HIGH,
        name="No Corporate Buzzwords",
        description="Eliminate overused corporate and marketing buzzwords.",
        instruction=(
            "Check for excessive use of these buzzwords — VIOLATED if 4+ present:\n"
            "  - Game-changing, Groundbreaking, Revolutionary, Transformative\n"
            "  - Disruptive, Unprecedented, Paradigm shift\n"
            "  - Synergy, Ecosystem, Leverage, Utilize\n"
            "  - Robust, Seamless, Holistic, Cutting-edge\n"
            "  - State-of-the-art, Best-in-class, World-class\n"
            "  - Unlock the power, Harness the power\n"
            "  - Navigate the complexities, Comprehensive overview\n"
        ),
        weight=0.08,
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 3 — GRAMMAR & READABILITY
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR006",
        type=RuleType.STATIC,
        category=RuleCategory.GRAMMAR,
        severity=RuleSeverity.HIGH,
        name="Grammar Correctness",
        description="Content must be grammatically correct throughout.",
        instruction=(
            "Check for:\n"
            "  - Subject-verb agreement errors\n"
            "  - Tense inconsistencies within sentences\n"
            "  - Article misuse (a/an/the)\n"
            "  - Dangling modifiers\n"
            "  - Run-on sentences (3+ clauses without proper punctuation)\n"
            "\n"
            "Flag specific grammatical errors with exact location."
        ),
        weight=0.08,
    ),

    Rule(
        id="SR007",
        type=RuleType.STATIC,
        category=RuleCategory.READABILITY,
        severity=RuleSeverity.MEDIUM,
        name="Sentence Length Variety",
        description="Sentences should vary in length for natural rhythm.",
        instruction=(
            "Check if the content has varied sentence lengths.\n"
            "Flag if:\n"
            "  - 5+ consecutive sentences are similar length (all long OR all short)\n"
            "  - Any single sentence exceeds 45 words\n"
            "  - All paragraphs follow identical length pattern\n"
            "\n"
            "Human writing naturally mixes short punchy sentences "
            "with longer, more detailed ones."
        ),
        weight=0.06,
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 4 — CONSISTENCY
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR008",
        type=RuleType.STATIC,
        category=RuleCategory.CONSISTENCY,
        severity=RuleSeverity.HIGH,
        name="Tense Consistency",
        description="Content must maintain consistent tense throughout.",
        instruction=(
            "Check for unexpected tense shifts.\n"
            "Flag if the content switches between past/present/future\n"
            "without clear logical reason.\n"
            "Narrative tense should be stable throughout each section."
        ),
        weight=0.07,
    ),

    Rule(
        id="SR009",
        type=RuleType.STATIC,
        category=RuleCategory.CONSISTENCY,
        severity=RuleSeverity.MEDIUM,
        name="Terminology Consistency",
        description="Same concepts must use consistent terminology.",
        instruction=(
            "Check if the same concept is referred to by multiple different names.\n"
            "E.g., switching between 'users', 'customers', 'clients', 'members'\n"
            "without clear purpose creates confusion.\n"
            "Flag inconsistent terminology for key concepts."
        ),
        weight=0.05,
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 5 — REPETITION & VERBOSITY
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR010",
        type=RuleType.STATIC,
        category=RuleCategory.REPETITION,
        severity=RuleSeverity.MEDIUM,
        name="No Phrase Repetition",
        description="Avoid repeating the same phrases or sentences.",
        instruction=(
            "Check for:\n"
            "  - Same phrase used 3+ times\n"
            "  - Near-identical sentences in different parts\n"
            "  - Repeated opening words across consecutive paragraphs\n"
            "\n"
            "Flag specific repeated phrases with examples."
        ),
        weight=0.05,
    ),

    Rule(
        id="SR011",
        type=RuleType.STATIC,
        category=RuleCategory.VERBOSITY,
        severity=RuleSeverity.LOW,
        name="No Unnecessary Filler",
        description="Eliminate filler words and redundant phrases.",
        instruction=(
            "Check for filler phrases that add length but no meaning:\n"
            "  - 'It is important to note that...'\n"
            "  - 'As we can see from the above...'\n"
            "  - 'In order to' (vs. just 'to')\n"
            "  - 'Due to the fact that' (vs. 'because')\n"
            "  - 'At this point in time' (vs. 'now')\n"
            "\n"
            "VIOLATED if 3+ filler phrases are present."
        ),
        weight=0.04,
    ),

    # ══════════════════════════════════════════════════════════════════
    # PRIORITY 6 — LOGICAL FLOW
    # ══════════════════════════════════════════════════════════════════

    Rule(
        id="SR012",
        type=RuleType.STATIC,
        category=RuleCategory.LOGICAL_FLOW,
        severity=RuleSeverity.HIGH,
        name="Logical Progression",
        description="Content must flow logically from beginning to end.",
        instruction=(
            "Evaluate the overall structure:\n"
            "  - Does the content have a clear opening that sets direction?\n"
            "  - Do ideas build on each other logically?\n"
            "  - Are there jarring topic jumps without transitions?\n"
            "  - Does the ending feel complete or abrupt?\n"
            "\n"
            "Flag specific logical gaps or disconnects."
        ),
        weight=0.07,
    ),

    Rule(
        id="SR013",
        type=RuleType.STATIC,
        category=RuleCategory.LOGICAL_FLOW,
        severity=RuleSeverity.MEDIUM,
        name="Strong Opening",
        description="Content must open with a specific, engaging statement.",
        instruction=(
            "Evaluate only the FIRST sentence or paragraph:\n"
            "  - Starts with a cliché ('In today's world...')? → VIOLATED\n"
            "  - Is it a vague generalization? → VIOLATED\n"
            "  - Makes a specific, interesting claim? → PASSED\n"
            "  - Poses a provocative question? → PASSED\n"
            "  - States a surprising or concrete fact? → PASSED\n"
        ),
        weight=0.05,
    ),
]


def get_static_rules() -> list[Rule]:
    return STATIC_RULES


def get_false_negative_rules() -> list[Rule]:
    """False negative rules alag se — pehle validate hote hain."""
    return [r for r in STATIC_RULES if r.category == RuleCategory.FALSE_NEGATIVE]


def get_rules_by_category(category: RuleCategory) -> list[Rule]:
    return [r for r in STATIC_RULES if r.category == category]


def get_critical_rules() -> list[Rule]:
    return [r for r in STATIC_RULES if r.severity == RuleSeverity.CRITICAL]


def get_total_weight() -> float:
    return sum(r.weight for r in STATIC_RULES)
