# apps/ai-engine/agents/canonical_writer.py
"""Agent 1 — Canonical Writer: generates the authoritative base document."""
import logging
import os

from services.llm import complete

log = logging.getLogger("ai-engine.canonical_writer")

# How much of the brand document the writer is shown. A 15-page report is about
# 37,000 characters; the old cut at 12,000 hid everything after the first third.
BRAND_DOC_CHARS = int(os.getenv("BRAND_DOC_CHARS_WRITER", "24000"))

SYSTEM = """You are a senior writer and editor who has spent a career writing pieces people finish and forward.
Your task is the canonical article: the one piece every other format is later written from. Its quality is the ceiling for everything downstream, so it has to be correct, specific and worth reading.

WHAT MAKES IT GOOD
1. One thesis. State it early in plain words, then earn it. Every section does a job the argument needs. If a section could be cut without the argument noticing, cut it.
2. Specific over general. Prefer the mechanism to the label, the named case to "many companies", the figure to "significant". Where you have no specific, reason from first principles and say that you are reasoning. Never cover the gap with a vague gesture.
3. Every paragraph adds something: a claim, why it holds, what follows from it. A paragraph that restates the one before it is deleted.
4. Open on something concrete: a claim with stakes, a situation, a tension in how people currently work. Never open with a definition, a greeting, or a remark about the era we live in. If you invent a scenario to illustrate a point, frame it as hypothetical ("Picture a team that...") so no reader takes it for a report of something that happened.
5. Write like a person. Plain words, active verbs, sentences of different lengths. A short sentence is for emphasis and rarely comes twice in a row. Use headings where the structure calls for them and write flowing prose underneath.
6. Take a position. Hedge only where the evidence really is uncertain, and say once what the uncertainty is.
7. End on the implication or the next step. Not a summary, not a moral, not a line that echoes the title.
8. Talk to the reader. Say "you" or "your" in the first paragraph and again in the body, tying each point to their situation. A piece that describes a topic from the outside for three paragraphs and only turns to the reader at the end reads as a lecture.
9. No quotable lines. Do not end paragraphs on a short polished sentence built to be screenshotted, and never put a metaphor where a claim belongs ("a different dream wearing the same vocabulary"). Say the plain thing and what follows from it. One short closing line in the whole piece is the most, and only if it carries a fact.

EVIDENCE (applies to the world, not only to the author)
Do not state a statistic, study, survey, named institution, named person, named company, date or dollar figure unless it appears in the context, verified profile facts or brand document you were given. "Researchers at X found..." and "an 80% drop" are inventions when no source gives them, and a reader will take them for fact.
An illustrative scenario is allowed only when it is framed as hypothetical ("Picture a team that...", "Suppose a project raises...") and uses no real names and no precise figures. A story structure is satisfied by a hypothetical scenario or by analysis, never by an invented event told as though it happened.
Where the argument needs evidence you do not have, reason from the mechanism and say what would have to be true.

SAY WHAT THINGS ARE
State the positive claim directly. Do not build a contrast by first saying what something is not ("It isn't X, it's Y", "not just X", "more than X", "less about X, more about Y", "X, not Y" tacked on the end). That construction is the most recognisable habit of machine writing. Say Y.

LANGUAGE TO LEAVE OUT
Grand openers (in today's..., in an ever-evolving...), hollow intensifiers (transformative, revolutionary, seamless, robust, unlock, leverage, game-changer, paradigm shift), three-item lists used for rhythm, rhetorical questions as transitions, section labels such as "Argument One:" in the prose, and any commentary about the writing itself.

╔══════════════════════════════════════════════════════════════════════════════╗
║                       FACTUAL GROUNDING CONTRACT                            ║
║                    THIS OVERRIDES EVERY OTHER RULE                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  You are writing AS a real, identifiable person. Everything you state       ║
║  about them will be published under their name.                             ║
║                                                                              ║
║  You may ONLY state a fact about the author if it appears in the            ║
║  VERIFIED PROFILE FACTS or CONTEXT sections of this prompt.                 ║
║                                                                              ║
║  NEVER invent any of the following. There are no exceptions:                ║
║                                                                              ║
║  ❌  Years of experience ("a decade in this space", "for years")            ║
║  ❌  Job titles, seniority or roles not stated in the profile               ║
║  ❌  Companies founded, owned, advised, or worked at                         ║
║  ❌  Teams, colleagues, clients, employees or mentees                        ║
║  ❌  Specific incidents, bugs, outages, launches or deployments              ║
║  ❌  Named frameworks or methodologies attributed to the author              ║
║  ❌  Metrics, benchmarks, user counts, TPS figures, revenue                  ║
║  ❌  Architecture or implementation details of the author's projects         ║
║      beyond what the profile states                                          ║
║  ❌  Emotional turning points, realisations or "lessons learned"             ║
║                                                                              ║
║  THE TEST: before writing any sentence containing "I", ask                  ║
║  "Which line of the profile says this?" If you cannot point to one,         ║
║  do not write the sentence.                                                  ║
║                                                                              ║
║  WHEN THE PROFILE IS THIN — this is the important case:                     ║
║  Write a factual, educational, analytical piece instead. Explain the        ║
║  subject on its merits, in the author's voice and vocabulary, WITHOUT       ║
║  first-person experience claims. A shorter, accurate piece is a             ║
║  SUCCESS. An engaging piece built on invented experience is a               ║
║  TOTAL FAILURE, no matter how well written.                                 ║
║                                                                              ║
║  Never trade accuracy for narrative texture. If a structural section        ║
║  asks for a story or evidence you do not have, satisfy that section        ║
║  with verified material, industry-level analysis, or a clearly              ║
║  hypothetical example marked as hypothetical. Never with invention.         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝"""


# ── Structure Flows ───────────────────────────────────────────────────────────

STRUCTURE_FLOWS = {
    "debate": {
        "name": "Debate",
        "flow": [
            "1. CLAIM — State a bold, clear, defensible position",
            "2. POPULAR ASSUMPTION — Acknowledge the prevailing belief",
            "3. COUNTERARGUMENT — Challenge the assumption with evidence",
            "4. SUPPORTING EVIDENCE — Data, examples, or expert insights",
            "5. PRACTICAL IMPLICATIONS — What this means for the reader",
            "6. DISCUSSION PROMPT — Open question that invites dialogue",
        ],
        "ideal_for": "Contrarian posts, opinion pieces, executive commentary",
    },
    "data_driven": {
        "name": "Data-Driven",
        "flow": [
            "1. OBSERVATION — Surface a pattern or trend widely visible but misunderstood",
            "2. INCORRECT INTERPRETATION — How most people wrongly interpret it",
            "3. ANALYSIS — What is actually happening using data or first principles",
            "4. FRAMEWORK — A reusable mental model or decision-making tool",
            "5. PRACTICAL APPLICATION — How to apply this in real scenarios",
        ],
        "ideal_for": "Research summaries, market commentary, consulting insights",
    },
    "story": {
        "name": "Story",
        "flow": [
            # Matches the wizard's Storytelling flow. The scene must come from
            # the verified profile or context; with none, tell the story of
            # the problem or an industry pattern, never an invented personal one.
            "1. SCENE SETTING — Who, what, when, where. Use a real situation from the verified profile or context; otherwise describe a situation in the industry, not one the author lived.",
            "2. CHALLENGE / CONFLICT — The tension or turning point",
            "3. JOURNEY — How the situation developed and what was tried",
            "4. RESOLUTION — How it was resolved or what changed",
            "5. TAKEAWAY — The transferable principle for the reader",
        ],
        "ideal_for": "Founder content, personal branding, case studies",
    },
    # Must match the flow the content wizard shows the user for "Thesis":
    # Hook → Thesis Statement → Supporting Arguments → Evidence → Conclusion.
    # The engine previously wrote a different six-beat flow, so reviewers
    # judging against the advertised framework found it "blended together".
    "thesis": {
        "name": "Thesis",
        "flow": [
            "1. HOOK — A concrete situation or tension that makes the reader need the answer. Do NOT open with the thesis itself.",
            "2. THESIS STATEMENT — One clear, defensible position, stated explicitly in its own sentence or two.",
            "3. SUPPORTING ARGUMENTS — Two to four DISTINCT arguments. Each must add a new reason; do not restate one argument several ways.",
            "4. EVIDENCE — For each argument, verifiable support: a documented case, a named standard or regulation, published research, data, or a fact from the verified profile. A hypothetical scenario is an ILLUSTRATION, not evidence — if you use one, introduce it as hypothetical ('Consider a bank that...'). If no verifiable evidence exists for a point, say so plainly rather than dressing an example up as proof.",
            "5. CONCLUSION — Return to the thesis once and state the strategic implication. One conclusion, not several overlapping ones.",
        ],
        "ideal_for": "Governance, economics, regulation, capital markets",
    },
    "incentive_diagnosis": {
        "name": "Incentive Diagnosis",
        "flow": [
            "1. OBSERVED BEHAVIOR — A behavior or outcome that seems irrational",
            "2. DECLARED INTENTIONS — What actors claim they are trying to achieve",
            "3. INCENTIVE MAPPING — The actual incentives each actor faces",
            "4. MISALIGNMENT — Where declared intentions and actual incentives diverge",
            "5. SYSTEMIC RISK — Cumulative risk this misalignment creates",
            "6. DIAGNOSTIC CONCLUSION — Diagnosis and path to realignment",
        ],
        "ideal_for": "Organizational analysis, public policy, corporate governance",
    },
    "listicle": {
        "name": "Listicle",
        "flow": [
            "1. HOOK — Compelling opening that establishes the value of the list",
            "2. POINT 1 — First key insight with brief explanation",
            "3. POINT 2 — Second insight",
            "4. POINT 3 — Third insight",
            "5. ADDITIONAL POINTS — Continue as needed (aim for 5-10 total)",
            "6. SUMMARY CTA — Synthesize and direct the reader",
        ],
        "ideal_for": "Quick-value content, social media, educational posts",
    },
    "problem_solution": {
        "name": "Problem → Solution",
        "flow": [
            "1. PROBLEM STATEMENT — Name the problem clearly and specifically",
            "2. WHY IT MATTERS — Stakes, consequences if unsolved",
            "3. COMMON MISTAKES — How most people approach this wrong",
            "4. THE SOLUTION — Your recommended approach with clear steps",
            "5. NEXT STEPS — Actionable guidance the reader can take today",
        ],
        "ideal_for": "Educational content, product positioning, tutorials",
    },
    "before_after": {
        "name": "Before → After → Bridge",
        "flow": [
            "1. BEFORE STATE — Paint the painful current reality vividly",
            "2. AFTER STATE — Describe the desirable future state",
            "3. BRIDGE — How to get from before to after",
            "4. CTA — Next step the reader should take",
        ],
        "ideal_for": "Sales content, transformation stories, product marketing",
    },
    "aida": {
        "name": "AIDA",
        "flow": [
            "1. ATTENTION — Grab attention with a bold claim, stat, or question",
            "2. INTEREST — Build interest with relevant facts or story",
            "3. DESIRE — Create desire by connecting to reader goals or pain",
            "4. ACTION — Clear, compelling CTA",
        ],
        "ideal_for": "Marketing copy, email campaigns, sales content",
    },
    "opinion": {
        "name": "Hot Take / Opinion",
        "flow": [
            "1. BOLD CLAIM — State the controversial or unconventional view clearly",
            "2. WHY MOST PEOPLE DISAGREE — Acknowledge the mainstream position fairly",
            "3. MY EVIDENCE — Support your view with specific examples or data",
            "4. NUANCED CONCLUSION — Acknowledge complexity without backing down",
        ],
        "ideal_for": "Thought leadership, personal brand building, engagement posts",
    },
    "case_study": {
        "name": "Case Study",
        "flow": [
            "1. CONTEXT — Background: who, what, why this matters",
            "2. CHALLENGE — The specific problem or obstacle faced",
            "3. APPROACH — The strategy or solution applied",
            "4. RESULTS — Concrete, specific outcomes achieved",
            "5. KEY LESSONS — What others can learn and apply",
        ],
        "ideal_for": "Social proof, consulting content, educational posts",
    },
}

WORD_COUNT_GUIDANCE = {
    150:  "150 words — a single tight argument. One idea, stated well.",
    200:  "200 words — very short. Two or three beats at most.",
    300:  "300 words — short-form. Cover the flow in a sentence or two per beat.",
    400:  "400 words — brief. Keep every section to its essential claim.",
    800:  "800 words — standard article length. Clear structure, no filler.",
    1200: "1200 words — in-depth treatment. Room for examples and analysis.",
    1500: "1500 words — long-form. Thorough exploration of the topic.",
    2000: "2000 words — comprehensive. Include frameworks, examples, data.",
    2500: "2500 words — authority piece. Deep research and extensive coverage.",
    3000: "3000+ words — pillar content. Definitive treatment of the subject.",
}

USER_TEMPLATE = """Write a canonical article following the exact structure below.

TOPIC: {topic}

STRATEGIC OBJECTIVE: {objective}

CONTEXT & KEY POINTS:
{context}

{grounding_block}

TARGET AUDIENCE: {audience}
Audience emphasis: {icp_emphasis}
Avoid: {icp_avoid}

NARRATIVE PERSPECTIVE: {perspective} — {perspective_voice}

CALL TO ACTION: {cta}

{brand_doc_block}

{voice_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WRITING STRUCTURE: {structure_name}
{structure_purpose}

REQUIRED FLOW:
{flow_steps}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{word_count_instruction}

LANGUAGE: {language}

{special_instructions}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEFORE YOU WRITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. What is the one claim of this piece? Write it down for yourself first.
2. What specific mechanism, case or figure from the material above proves it?
3. Which sentence of yours says "X is not Y"? Rewrite it as "X is Z".
4. Before any sentence with "I": which line of the verified profile says this? No line, no sentence.
5. Before any number, study, institution or event: which line of the material above says this? No line, no sentence. A scenario must be marked hypothetical.

EXECUTION RULES:
- Start with a headline that states the claim or the stakes
- Follow the structural flow in order; each beat is present and carries a real point
- Write in the specified narrative perspective
- Do NOT print the structure's step names; write connected prose
- Every sentence earns its place; cut anything that only restates
- Include the CTA naturally in the conclusion
- Every claim about the author must trace to the verified profile
- Where verified material runs out, write analysis rather than anecdote
- Keep examples and evidence distinct: an example illustrates a point, evidence
  proves it. Never present a hypothetical as proof, and never claim something
  "exists today" or "is happening" without naming what or where

Write the full article now:"""


REVISE_SYSTEM = """You are a line editor. Rewrite ONLY the flagged sentences so each states its point directly and specifically. Keep every other sentence exactly as written.
Add nothing: no new fact, name, number, example or experience. Keep every claim, the structure, the headings and the length (within 5%). Do not build contrasts ("not X but Y").
Return the full article, nothing else."""

# Density, in effective tells per 100 words, above which the writer's own draft
# is sent back once. The frozen corpus averages 2.4 across short posts; a long
# article that reaches 1.5 is carrying the habit through most of its paragraphs.
REVISE_DENSITY = 1.5


async def _revise_if_tell_heavy(
    content: str, max_tokens: int, brand_rules: str = ""
) -> tuple[str, int]:
    try:
        from services.tells import tell_report, format_for_prompt
        report = tell_report(content)
        if report["per_100_words"] < REVISE_DENSITY or report["effective_count"] < 4:
            return content, 0
        flagged = format_for_prompt(content, limit=15)
        # This pass used to see only the draft, so a rewrite could undo the
        # brand's tone or reintroduce a banned phrase the writer had avoided.
        rules_block = f"{brand_rules}\n\n" if brand_rules else ""
        revised, tokens = await complete(
            REVISE_SYSTEM,
            f"{rules_block}FLAGGED SENTENCES:\n{flagged}\n\nARTICLE:\n{content}",
            temperature=0.3,
            max_tokens=max_tokens,
        )
        revised = (revised or "").strip()
        after = tell_report(revised)
        # Keep the revision only if it helped and did not hollow the piece out.
        if (
            revised
            and 0.85 * len(content) <= len(revised) <= 1.15 * len(content)
            and after["effective_count"] < report["effective_count"]
        ):
            log.info(
                "Canonical revised | tells %d -> %d",
                report["effective_count"], after["effective_count"],
            )
            return revised, tokens
        return content, tokens
    except Exception as e:  # pragma: no cover - revision must never block a run
        log.warning("Canonical revision skipped (non-fatal): %s", e)
        return content, 0


def _build_custom_flow_block(flow: list[str]) -> tuple[str, str, str]:
    numbered = [f"{i+1}. {step}" for i, step in enumerate(flow)]
    return "Custom Structure", "User-defined writing structure", "\n".join(numbered)


async def run(
    topic:                 str,
    objective:             str              = "Build thought leadership",
    context:               str              = "",
    audience:              str              = "General Business",
    icp_emphasis:          str              = "",
    icp_avoid:             str              = "",
    perspective:           str              = "Founder",
    perspective_voice:     str              = "",
    structure:             str              = "thesis",
    custom_structure_flow: list[str] | None = None,
    cta:                   str              = "",
    language:              str              = "English",
    word_count:            int | None       = None,
    special_instructions:  str              = "",
    tonality_spectrum:     dict | None      = None,
    brand_document_context: str             = "",
    verified_profile_facts: str             = "",
    compliance_notes:      str              = "",
    preferred_terms:       list[str] | None = None,
    brand_tone:            dict | None      = None,
    banned_phrases:        list[str] | None = None,
    voice_source:          str              = "",
) -> dict:

    if custom_structure_flow and len(custom_structure_flow) > 0:
        structure_name, structure_purpose, flow_text = _build_custom_flow_block(
            custom_structure_flow
        )
        struct = None
    else:
        key    = structure.lower().replace(" ", "_").replace("-", "_")
        struct = STRUCTURE_FLOWS.get(key, STRUCTURE_FLOWS["thesis"])
        structure_name    = struct["name"]
        structure_purpose = f"Ideal for: {struct['ideal_for']}"
        flow_text         = "\n".join(struct["flow"])

    if word_count:
        guidance       = WORD_COUNT_GUIDANCE.get(word_count, f"approximately {word_count} words")
        wc_instruction = f"LENGTH REQUIREMENT: {guidance}"
        # Structure is a hard requirement ("each section must be present and
        # substantive") while length was only guidance, so short targets lost
        # the argument — a 300-word request measured 41% over. Tell the model
        # explicitly how to satisfy both.
        if word_count <= 400:
            wc_instruction += (
                "\n\nThis is a SHORT piece and the limit is firm. Cover every "
                "structural beat, but give tight targets one or two sentences "
                "each rather than a full paragraph. Compress — do not drop a "
                "section, and do not run over."
            )
    else:
        wc_instruction = "LENGTH: 1000-1500 words"

    max_tok = int((word_count or 1500) * 1.5) + 500
    max_tok = min(max(max_tok, 2000), 8000)

    from services.prompt_compiler import PERSPECTIVE_VOICE, ICP_EMPHASIS
    pv       = perspective_voice or PERSPECTIVE_VOICE.get(perspective, perspective)
    icp      = ICP_EMPHASIS.get(audience, ICP_EMPHASIS["General Business"])
    emphasis = icp_emphasis or icp["emphasis"]
    avoid    = icp_avoid    or icp["avoid"]

    # ── Brand Document Context Block ──
    # 4000 chars truncated detailed profiles hard enough that the writer ran
    # out of verified material and filled the gap with invention.
    brand_doc_block = ""
    if brand_document_context and brand_document_context.strip():
        trimmed_docs = brand_document_context[:BRAND_DOC_CHARS]
        brand_doc_block = f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND DOCUMENT GUIDELINES (Base Voice):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{trimmed_docs}

Ensure the canonical draft fundamentally aligns with this brand's voice,
vocabulary, and strategic constraints from the very first draft.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

    # ── Measured Voice Block ──
    # The document above tells the writer what this brand says. This says how
    # they say it, as numbers taken from that same document. "Vary sentence
    # rhythm" is advice every brand received identically; "sentences average
    # nine words and 42% are under eight" is a target.
    #
    # Absent or too short a document, there is no block. Generic guidance is
    # honest; a rhythm derived from four sentences would not be.
    voice_block = ""
    try:
        from services.voice import measure, describe
        # Rhythm is read from the document as uploaded. When it was condensed
        # into a brief, the brief has none of the brand's own sentences.
        voice_profile = measure(voice_source or brand_document_context)
        described = describe(voice_profile, brand_tone)
        if described:
            voice_block = f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{described}

Write to this rhythm. It is a centre of gravity, not a rule for every line —
this piece has its own length and platform.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""
    except Exception as e:  # pragma: no cover - measurement must never block
        log.warning("Voice measurement unavailable (non-fatal): %s", e)

    # ── Grounding Block ──
    # Names the only permissible source of first-person claims. Without a
    # profile the writer must drop the persona rather than invent one.
    # The brand document is already in the prompt above, in full up to its
    # limit. Repeating it here doubled the cost of every call and, with the
    # limit raised, would have sent up to 48,000 characters of the same text.
    _parts = [
        part.strip()
        for part in (verified_profile_facts,)
        if part and part.strip()
    ]
    if brand_document_context and brand_document_context.strip():
        _parts.append(
            "The BRAND DOCUMENT GUIDELINES above are also verified material: "
            "first-person claims may rest on what they state."
        )
    verified = "\n\n".join(_parts)

    if verified:
        grounding_block = f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERIFIED PROFILE FACTS — THE ONLY PERMITTED SOURCE OF
FIRST-PERSON CLAIMS ABOUT THE AUTHOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{verified}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Anything about the author that is absent above does not exist for this
article. No experience durations, employers, teams, clients, incidents,
named frameworks, metrics, or architecture details beyond these lines.

If this profile does not contain a story or a piece of evidence that a
structural section calls for, satisfy that section with verified facts or
industry-level analysis. Never with an invented anecdote.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""
    else:
        grounding_block = """━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NO VERIFIED PROFILE SUPPLIED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nothing about the author has been verified, so make NO first-person
claims about their experience, role, employer, projects or history.

Write in an analytical, educational register about the subject itself.
Do not construct a persona to carry the argument.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""

    # ── Brand compliance rules ──
    # Rules such as "keep claims tied to actual experience" or "use exact
    # paper titles" govern what the draft may say. They used to reach only the
    # brand optimizer and QA — after the draft was written — where they could
    # polish wording but not change what had been claimed.
    rules_parts = []
    if compliance_notes and compliance_notes.strip():
        rules_parts.append(
            "BRAND COMPLIANCE RULES (binding — follow every one):\n"
            + compliance_notes.strip()[:3000]
        )
    terms = [t.strip() for t in (preferred_terms or []) if isinstance(t, str) and t.strip()]
    if terms:
        rules_parts.append(
            "PREFERRED TERMINOLOGY (use these exact terms where relevant): "
            + ", ".join(terms[:30])
        )
    banned = [b.strip() for b in (banned_phrases or []) if isinstance(b, str) and b.strip()]
    if banned:
        rules_parts.append(
            "BANNED PHRASES (never use them; say it plainly): " + ", ".join(banned[:30])
        )
    from services.brand_tone import describe as describe_brand_tone
    tone_text = describe_brand_tone(brand_tone)
    if tone_text:
        rules_parts.append(tone_text)
    if rules_parts:
        grounding_block += "\n\n" + "\n\n".join(rules_parts)

    user_prompt = USER_TEMPLATE.format(
        topic=topic,
        objective=objective,
        context=context or (
            "No additional context was supplied. Write a factual, analytical "
            "treatment of the topic. Do NOT compensate by inventing personal "
            "experience, incidents, or credentials for the author."
        ),
        audience=audience,
        icp_emphasis=emphasis,
        icp_avoid=avoid,
        perspective=perspective,
        perspective_voice=pv,
        cta=cta or "No specific CTA required.",
        brand_doc_block=brand_doc_block,
        voice_block=voice_block,
        grounding_block=grounding_block,
        structure_name=structure_name,
        structure_purpose=structure_purpose,
        flow_steps=flow_text,
        word_count_instruction=wc_instruction,
        language=language,
        special_instructions=(
            f"SPECIAL INSTRUCTIONS:\n{special_instructions}"
            if special_instructions else ""
        ),
    )

    content, tokens = await complete(
        SYSTEM,
        user_prompt,
        temperature=0.6,
        max_tokens=max_tok,
    )

    # Every format is written from this draft, so a habit left in it is
    # inherited thirteen times. Only a clearly tell-heavy draft is revised;
    # one that reads fine costs nothing extra.
    revise_rules = "\n\n".join(rules_parts)
    revised, extra_tokens = await _revise_if_tell_heavy(content, max_tok, revise_rules)
    content = revised
    tokens += extra_tokens

    return {
        "content":       content,
        "tokensUsed":    tokens,
        "agent":         "canonical_writer",
        "structure":     structure_name,
        "structureFlow": (
            custom_structure_flow if custom_structure_flow
            else (struct["flow"] if struct else [])
        ),
    }