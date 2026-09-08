"""Agent 2 — Platform Optimizer: adapts canonical draft to channel-specific format."""
from services.llm import complete

NL = chr(10)

SYSTEM = """You are an expert content strategist specializing in platform-specific optimization.
You understand the unique formatting, pacing, algorithm behavior, and stylistic conventions of each publishing channel.
Transform content to fit the platform perfectly while preserving the core strategic message.
OUTPUT: Write only the final optimized content. No meta-commentary, no labels, no preamble.

ADAPTATION LIMITS - these bind every rewrite:
1. You may cut, compress, reorder and reformat. You may NOT add any fact,
   claim, number, credential or experience that is absent from the draft.
   Shortening must never introduce something new.
2. Any MUST-PRESERVE item listed in the prompt has to survive into the final
   output. Cut elsewhere to make room; those items are not optional.
3. Where the draft is vague, keep it vague. Do not sharpen an unsourced claim
   into a confident specific one."""

# ─── Platform Specifications ──────────────────────────────────────────────────

PLATFORM_SPECS = {
    "linkedin_post": {
        "name": "LinkedIn Post",
        "length": "150-300 words",
        "rules": [
            "Start with ONE bold hook line — visible before 'see more' click",
            "Then press Enter twice — white space is critical on LinkedIn",
            "Short paragraphs: 1-2 sentences maximum",
            "Mix sentence lengths for rhythm",
            "Professional but conversational — not corporate",
            "End with ONE discussion question or CTA",
            "Max 3-5 relevant hashtags at the very end (separate line)",
            "Avoid bullet-point overuse",
            "Total: 150-300 words",
        ],
    },
    "linkedin_article": {
        "name": "LinkedIn Article",
        "length": "800-1200 words",
        "rules": [
            "Clear, value-signaling headline",
            "Structured with H2/H3 subheadings every 2-3 paragraphs",
            "Professional thought leadership tone",
            "Data points and concrete examples throughout",
            "End with 3-5 key takeaways in a bullet list",
            "Author bio paragraph at the end",
        ],
    },
    "x_post": {
        "name": "X (Twitter) Post",
        "length": "240-280 characters",
        "rules": [
            "Single punchy insight, question, or provocative statement",
            "Conversational and direct — like you're texting",
            "Zero to one hashtag maximum",
            "Count characters — hard limit 280",
            "No threads — standalone single post only",
        ],
    },
    "x_thread": {
        "name": "X Thread",
        "length": "8-12 tweets, each under 280 characters",
        "rules": [
            "Tweet 1: Most provocative/surprising hook — makes people NEED to read more",
            "Tweets 2-10+: One idea per tweet, numbered (2/10, 3/10...)",
            "Each tweet must deliver standalone value — not cliffhangers",
            "Last tweet: Summary + single CTA",
            "Separate each tweet with a line: ---",
            "STRICT: Each tweet under 280 characters",
        ],
    },
    "twitter_thread": {
        # Alias for x_thread
        "name": "Twitter/X Thread",
        "length": "8-12 tweets, each under 280 characters",
        "rules": [
            "Tweet 1: Bold hook — most provocative point up front",
            "Tweets 2-10+: One idea per tweet, numbered format",
            "Each tweet delivers value on its own",
            "Final tweet: Summary + CTA",
            "Separate tweets with: ---",
            "Hard limit: 280 characters per tweet",
        ],
    },
    "blog_post": {
        "name": "Blog Post",
        "length": "Follows word count specification",
        "rules": [
            "SEO-optimized headline (include primary keyword if specified)",
            "Introduction: address a pain point in the first 100 words",
            "Use H2/H3 subheadings every 2-3 paragraphs",
            "Include practical, actionable sections",
            "Use numbered lists or bullets for steps/tips",
            "Conclusion with summary + CTA",
            "Add meta description suggestion at the very end (under META DESCRIPTION: label)",
        ],
    },
    "newsletter": {
        "name": "Newsletter",
        "length": "400-700 words",
        "rules": [
            "SUBJECT LINE: [Write subject line here] — as the very first line",
            "Warm, personal opening — as if writing to a close colleague",
            "Short paragraphs — easy to skim on mobile",
            "One main insight or story per newsletter",
            "Personal observation or aside somewhere in the middle",
            "Clear CTA or next step at the end",
            "Sign-off with name/persona",
        ],
    },
    "instagram_caption": {
        "name": "Instagram Caption",
        "length": "125-150 words (displayed) + hashtags",
        "rules": [
            "First line is the HOOK — must be compelling before 'more' is clicked",
            "Line breaks between key thoughts for readability",
            "Conversational, authentic voice — not corporate",
            "Emojis used sparingly and purposefully (2-4 total)",
            "End with a question to drive comments",
            "Hashtags section at the end: 10-15 relevant hashtags on separate lines",
            "Total visible text: 125-150 words",
        ],
    },
    "youtube_script": {
        "name": "YouTube Script",
        "length": "800-1200 words (approx. 5-8 minute video)",
        "rules": [
            "HOOK (0-30 sec): Start with the payoff — what viewers will learn",
            "Brief intro: Establish credibility and topic in under 30 seconds",
            "Main content: 3-5 sections with clear transitions",
            "Use [VISUAL CUE] markers where relevant graphics/cuts should appear",
            "Conversational spoken language — write how you talk, not how you write",
            "Include [PAUSE] markers for emphasis",
            "CTA before outro (30 seconds from end)",
            "OUTRO: Subscribe ask + preview next video",
            "Format: Clearly label HOOK, INTRO, SECTION 1, etc.",
        ],
    },
    "podcast_notes": {
        "name": "Podcast Show Notes & Talking Points",
        "length": "400-600 words",
        "rules": [
            "Episode title suggestion at top",
            "Episode summary (2-3 sentences for podcast apps)",
            "TALKING POINTS section with 5-8 key discussion points as bullets",
            "Each talking point has 1-2 sub-bullets with detail",
            "KEY QUOTES section: 2-3 quotable one-liners from the content",
            "RESOURCES MENTIONED section (placeholder)",
            "CTA for listeners at the end",
        ],
    },
    "landing_page": {
        "name": "Landing Page Copy",
        "length": "300-600 words",
        "rules": [
            "HEADLINE: Single-line value proposition",
            "SUBHEADLINE: Expand the promise in 1-2 sentences",
            "3 benefit bullets (outcome-focused, not feature-focused)",
            "[TESTIMONIAL PLACEHOLDER]",
            "One clear CTA button text",
            "Optional: urgency or scarcity element",
        ],
    },
    "executive_brief": {
        "name": "Executive Brief",
        "length": "300-500 words",
        "rules": [
            "TL;DR: 2-3 sentence summary at the very top",
            "Formal, direct tone — executives are busy",
            "KEY FINDINGS or RECOMMENDATIONS as labeled bullets",
            "Business impact focus: ROI, risk, opportunity",
            "ACTION ITEMS section at the end",
        ],
    },
    "whatsapp_status": {
        "name": "WhatsApp Status / Short Message",
        "length": "50-80 words",
        "rules": [
            "Ultra-short — 50-80 words maximum",
            "One powerful insight or statement",
            "No hashtags",
            "Casual, direct voice",
            "Works as a standalone message",
        ],
    },
}

# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Transform this canonical article into optimized {platform_name} content.

CANONICAL ARTICLE:
{canonical_draft}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARGET PLATFORM: {platform_name}
LENGTH: {length}

PLATFORM RULES:
{rules}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{extra_instructions}

Write the optimized {platform_name} content now:"""


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(
    canonical_draft: str,
    target_platform: str,
    audience_note:   str        = "",
    word_count:      int | None = None,
    seo_enabled:     bool       = False,
    seo_settings:    dict       = None,
    cta:             str        = "",
    must_preserve:   str        = "",
) -> dict:
    """
    Adapt canonical draft to target platform format.
    """
    spec = PLATFORM_SPECS.get(
        target_platform.lower().replace(" ", "_").replace("-", "_"),
        PLATFORM_SPECS["linkedin_post"]
    )

    rules_text = "\n".join(f"  • {r}" for r in spec["rules"])

    extra_parts = []
    if must_preserve and must_preserve.strip():
        # Compression used to quietly drop strategic framing the user had
        # explicitly asked for, because this agent never saw the request.
        extra_parts.append(
            "MUST-PRESERVE (from the original request - these survive the cut):"
            + NL + must_preserve.strip()
        )
    if audience_note:
        extra_parts.append(f"AUDIENCE NOTE:\n{audience_note}")
    if cta:
        extra_parts.append(f"CALL TO ACTION:\n{cta}")
    if word_count:
        extra_parts.append(f"TARGET LENGTH GUIDANCE: Aim for approximately {word_count} words.")
    if seo_enabled and seo_settings:
        from services.prompt_compiler import _build_seo_block
        seo_text = _build_seo_block(seo_enabled, seo_settings)
        if seo_text:
            extra_parts.append(seo_text)

    extra_instructions = (NL + NL).join(extra_parts) if extra_parts else ""

    user_prompt = USER_TEMPLATE.format(
        platform_name=spec["name"],
        canonical_draft=canonical_draft,
        length=spec["length"],
        rules=rules_text,
        extra_instructions=extra_instructions,
    )

    content, tokens = await complete(
        SYSTEM,
        user_prompt,
        temperature=0.7,
        max_tokens=4000 if target_platform in ["blog_post", "linkedin_article", "youtube_script"] else 2000,
    )

    return {
        "content":    content,
        "tokensUsed": tokens,
        "agent":      "platform_optimizer",
        "platform":   target_platform,
    }
