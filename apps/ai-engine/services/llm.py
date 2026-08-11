"""LLM abstraction — OpenAI/DeepSeek primary, Claude fallback."""
import os
import asyncio
import logging
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

import anthropic
from anthropic.types import TextBlock
import openai

log = logging.getLogger("ai-engine.llm")

# ─── Config ───────────────────────────────────────────────────────────────────

ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_KEY      = os.getenv("OPENAI_API_KEY", "")
CLAUDE_MODEL    = os.getenv("ANTHROPIC_MODEL",  "claude-sonnet-4-6")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL",     "deepseek-chat")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or None

# Per-call timeout (seconds) — Render free tier is slow
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT_SECONDS", "90"))

# Which provider to try first
_DEFAULT_PREFER = "openai" if OPENAI_KEY else "claude"

# ─── Clients ──────────────────────────────────────────────────────────────────

_anthropic_client = (
    anthropic.AsyncAnthropic(api_key=ANTHROPIC_KEY)
    if ANTHROPIC_KEY else None
)

_openai_client = (
    openai.AsyncOpenAI(
        api_key=OPENAI_KEY,
        base_url=OPENAI_BASE_URL,
        timeout=LLM_TIMEOUT,
    )
    if OPENAI_KEY else None
)

log.info(
    "LLM init | primary=%s | openai_model=%s | claude_model=%s | base_url=%s | timeout=%ds",
    _DEFAULT_PREFER,
    OPENAI_MODEL,
    CLAUDE_MODEL,
    OPENAI_BASE_URL or "api.openai.com",
    LLM_TIMEOUT,
)

# ─── Retry decorators ─────────────────────────────────────────────────────────

# OpenAI/DeepSeek retryable errors
_openai_retryable = retry_if_exception_type((
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.InternalServerError,
))

# Anthropic retryable errors
_anthropic_retryable = retry_if_exception_type((
    anthropic.RateLimitError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
    anthropic.InternalServerError,
))

# ─── Provider: OpenAI / DeepSeek ─────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=15),
    retry=_openai_retryable,
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
async def complete_openai(
    system:      str,
    user:        str,
    temperature: float = 0.7,
    max_tokens:  int   = 4096,
) -> tuple[str, int]:
    if not _openai_client:
        raise RuntimeError("OPENAI_API_KEY not configured")

    resp = await asyncio.wait_for(
        _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        ),
        timeout=LLM_TIMEOUT,
    )

    text   = resp.choices[0].message.content or ""
    tokens = resp.usage.total_tokens if resp.usage else 0

    log.info(
        "OpenAI done | model=%s | tokens=%d | chars=%d",
        OPENAI_MODEL, tokens, len(text)
    )
    return text, tokens


# ─── Provider: Anthropic Claude ───────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=15),
    retry=_anthropic_retryable,
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
async def complete_claude(
    system:      str,
    user:        str,
    temperature: float = 0.7,
    max_tokens:  int   = 4096,
) -> tuple[str, int]:
    if not _anthropic_client:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    resp = await asyncio.wait_for(
        _anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            system=system,
            messages=[{"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
        ),
        timeout=LLM_TIMEOUT,
    )

    text_blocks = [b for b in resp.content if isinstance(b, TextBlock)]
    text   = text_blocks[0].text if text_blocks else ""
    tokens = (
        resp.usage.input_tokens + resp.usage.output_tokens
        if resp.usage else 0
    )

    log.info(
        "Claude done | model=%s | tokens=%d | chars=%d",
        CLAUDE_MODEL, tokens, len(text)
    )
    return text, tokens


# ─── Unified Entry Point ──────────────────────────────────────────────────────

async def complete(
    system:      str,
    user:        str,
    temperature: float       = 0.7,
    max_tokens:  int         = 4096,
    prefer:      str | None  = None,
) -> tuple[str, int]:
    """
    Call primary LLM provider; fallback to secondary on any failure.

    Returns:
        (text, total_tokens)
    """
    primary   = prefer or _DEFAULT_PREFER
    secondary = "openai" if primary == "claude" else "claude"

    has_primary   = (primary   == "openai" and bool(OPENAI_KEY)) or \
                    (primary   == "claude" and bool(ANTHROPIC_KEY))
    has_secondary = (secondary == "openai" and bool(OPENAI_KEY)) or \
                    (secondary == "claude" and bool(ANTHROPIC_KEY))

    if not has_primary and not has_secondary:
        raise RuntimeError(
            "No LLM provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
        )

    async def _call(provider: str) -> tuple[str, int]:
        if provider == "claude":
            return await complete_claude(system, user, temperature, max_tokens)
        return await complete_openai(system, user, temperature, max_tokens)

    # Try primary
    if has_primary:
        try:
            return await _call(primary)
        except Exception as err:
            log.warning(
                "Primary LLM (%s) failed after retries: %s — trying fallback",
                primary, err
            )

    # Try secondary fallback
    if has_secondary:
        try:
            log.info("Using fallback LLM: %s", secondary)
            return await _call(secondary)
        except Exception as fallback_err:
            raise RuntimeError(
                f"Both LLM providers failed. "
                f"Primary ({primary}): see logs. "
                f"Fallback ({secondary}): {fallback_err}"
            ) from fallback_err

    raise RuntimeError(f"LLM provider '{primary}' not available")
