"""Agent 1 — Canonical Writer: generates the authoritative base document."""
from services.llm import complete

SYSTEM = """You are an expert content strategist and senior writer.
Your task: produce a comprehensive, publication-ready canonical article.
Follow the specified writing structure EXACTLY — each section must be present.
Write with clarity, analytical depth, and editorial precision.
Do NOT include meta-commentary, section labels, or structural annotations in output.
Write flowing prose that feels human and opinionated, not templated."""


# ─── Built-in Structure Flows ─────────────────────────────────────────────────

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
            "1. SITUATION — Set the scene: who, what, when, where",
            "2. CONFLICT — The challenge, tension, or turning point",
            "3. LESSON — What was learned or how it was resolved",
            "4. FRAMEWORK — The transferable principle from the story",
            "5. BROADER IMPLICATION — Connect to a wider audience or larger trend",
        ],
        "ideal_for": "Founder content, personal branding, case studies",
    },
    "thesis": {
        "name": "Thesis",
        "flow": [
            "1. STRUCTURAL CLAIM — A precise, defensible thesis about how a system works",
            "2. PREVAILING ASSUMPTION — The dominant belief your thesis challenges",
            "3. FAILURE MODE — Where and why the prevailing assumption breaks down",
            "4. UNDERLYING MECHANICS — Root cause or mechanism driving the failure",
            "5. SECOND-ORDER EFFECTS — Downstream consequences most people overlook",
            "6. STRATEGIC IMPLICATION — What decision-makers should do differently",
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
    # ── New structures (from content wizard) ─────────────────────────────────
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

# ─── Word Count Guidance ──────────────────────────────────────────────────────

WORD_COUNT_GUIDANCE = {
    500:  "500 words — concise, punchy. Every sentence must earn its place.",
    800:  "800 words — standard article length. Clear structure, no filler.",
    1200: "1200 words — in-depth treatment. Room for examples and analysis.",
    1500: "1500 words — long-form. Thorough exploration of the topic.",
    2000: "2000 words — comprehensive. Include frameworks, examples, data.",
    2500: "2500 words — authority piece. Deep research and extensive coverage.",
    3000: "3000+ words — pillar content. Definitive treatment of the subject.",
}

# ─── User Prompt Template ─────────────────────────────────────────────────────

USER_TEMPLATE = """Write a canonical article following the exact structure below.

TOPIC: {topic}

STRATEGIC OBJECTIVE: {objective}

CONTEXT & KEY POINTS:
{context}

TARGET AUDIENCE: {audience}
Audience emphasis: {icp_emphasis}
Avoid: {icp_avoid}

NARRATIVE PERSPECTIVE: {perspective} — {perspective_voice}

CALL TO ACTION: {cta}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WRITING STRUCTURE: {structure_name}
{structure_purpose}

REQUIRED FLOW:
{flow_steps}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{word_count_instruction}

LANGUAGE: {language}

{special_instructions}

EXECUTION RULES:
- Write a compelling headline first
- Follow the structural flow exactly — each section must be present and substantive
- Write in the specified narrative perspective
- Do NOT label sections — write flowing, connected prose
- Maintain analytical depth throughout — no filler sentences
- Include the CTA naturally in the conclusion

Write the full article now:"""


# ─── Custom Structure Handler ─────────────────────────────────────────────────

def _build_custom_flow_block(flow: list[str]) -> tuple[str, str, str]:
    """Convert custom flow array into formatted prompt sections."""
    numbered = [f"{i+1}. {step}" for i, step in enumerate(flow)]
    return (
        "Custom Structure",
        "User-defined writing structure",
        "\n".join(numbered),
    )


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(
    topic:               str,
    objective:           str         = "Build thought leadership",
    context:             str         = "",
    audience:            str         = "General Business",
    icp_emphasis:        str         = "",
    icp_avoid:           str         = "",
    perspective:         str         = "Founder",
    perspective_voice:   str         = "",
    structure:           str         = "thesis",
    custom_structure_flow: list[str] | None = None,
    cta:                 str         = "",
    language:            str         = "English",
    word_count:          int | None  = None,
    special_instructions: str        = "",
    tonality_spectrum:   dict | None = None,
) -> dict:
    """
    Generate the canonical article.

    Priority: custom_structure_flow > structure lookup > thesis default
    """
    # ── Resolve structure ─────────────────────────────────────────────────────
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

    # ── Word count instruction ────────────────────────────────────────────────
    wc_instruction = ""
    if word_count:
        guidance = WORD_COUNT_GUIDANCE.get(
            word_count,
            f"approximately {word_count} words"
        )
        wc_instruction = f"LENGTH REQUIREMENT: {guidance}"
    else:
        wc_instruction = "LENGTH: 1000-1500 words"

    # ── Max tokens based on word count ────────────────────────────────────────
    # ~1.3 tokens per word, plus overhead
    max_tok = int((word_count or 1500) * 1.5) + 500
    max_tok = min(max(max_tok, 2000), 8000)  # clamp 2000-8000

    # ── Perspective voice ─────────────────────────────────────────────────────
    from services.prompt_compiler import PERSPECTIVE_VOICE
    pv = perspective_voice or PERSPECTIVE_VOICE.get(perspective, perspective)

    # ── ICP from context if not passed directly ───────────────────────────────
    from services.prompt_compiler import ICP_EMPHASIS
    icp = ICP_EMPHASIS.get(audience, ICP_EMPHASIS["General Business"])
    emphasis = icp_emphasis or icp["emphasis"]
    avoid    = icp_avoid    or icp["avoid"]

    # ── Build prompt ──────────────────────────────────────────────────────────
    user_prompt = USER_TEMPLATE.format(
        topic=topic,
        objective=objective,
        context=context or "No additional context. Draw from your expertise.",
        audience=audience,
        icp_emphasis=emphasis,
        icp_avoid=avoid,
        perspective=perspective,
        perspective_voice=pv,
        cta=cta or "No specific CTA required.",
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
        temperature=0.75,
        max_tokens=max_tok,
    )

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
