# apps/ai-engine/main.py
"""MCAP AI Engine — Production hardened FastAPI orchestrator v3.1."""
import os
import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

load_dotenv()

from agents import canonical_writer, platform_optimizer, brand_optimizer, humanizer, qa_agent, refiner
from agents.rule_engine import RuleEngineOrchestrator
from services.scoring         import score as score_content
from services.prompt_compiler import PDLRequest, compile as compile_prompt
from services.pre_generation_validator import validate_and_fix

log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ai-engine")


def validate_env() -> None:
    required = ["OPENAI_API_KEY"]
    missing  = [k for k in required if not os.getenv(k)]
    if missing:
        raise EnvironmentError(f"Missing required env vars: {missing}")


def get_allowed_origins() -> list[str]:
    origins = ["http://localhost:4000", "http://localhost:3000"]
    raw = os.getenv("ALLOWED_ORIGINS", "")
    if raw:
        for host in raw.split(","):
            host = host.strip()
            if not host:
                continue
            if not host.startswith("http"):
                host = f"https://{host}"
            origins.append(host)
    log.info("Allowed CORS origins: %s", origins)
    return origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        validate_env()
        log.info(
            "MCAP AI Engine started | PORT=%s | MODEL=%s | ENV=%s",
            os.getenv("PORT", "8000"),
            os.getenv("OPENAI_MODEL", "unknown"),
            os.getenv("ENVIRONMENT", "development"),
        )
    except EnvironmentError as e:
        log.critical("Startup failed: %s", e)
        raise
    yield
    log.info("MCAP AI Engine shutting down")


app = FastAPI(
    title="MCAP AI Engine",
    version="3.1.0",
    description="Multi-agent content pipeline with Rule Engine",
    lifespan=lifespan,
    docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_origin_regex=r"https://.*\.(onrender\.com|railway\.app|vercel\.app)",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time
    start      = time.time()
    request_id = request.headers.get("X-Request-ID", "unknown")
    try:
        response = await call_next(request)
        duration = round((time.time() - start) * 1000, 2)
        if request.url.path != "/health":
            log.info(
                "%s %s | %d | %sms | req_id=%s",
                request.method, request.url.path,
                response.status_code, duration, request_id,
            )
        return response
    except Exception as e:
        duration = round((time.time() - start) * 1000, 2)
        log.error("Request failed: %s | %sms | req_id=%s", e, duration, request_id)
        raise


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    log.error(
        "Unhandled exception | path=%s | type=%s | error=%s\n%s",
        request.url.path, type(exc).__name__, exc, tb
    )
    is_prod = os.getenv("ENVIRONMENT") == "production"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": f"{type(exc).__name__}: {str(exc)[:300]}" if not is_prod else "Internal server error",
            "path":  request.url.path,
        },
    )


PIPELINE_TIMEOUT = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "300"))


async def run_with_timeout(coro, timeout: int = PIPELINE_TIMEOUT):
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Operation timed out after {timeout}s",
        )


# ── Safe extractors ───────────────────────────────────────────────────────────

def _extract_rule_engine_meta(item) -> dict:
    """Safely extract rule_engine metadata from humanizer output."""
    if not isinstance(item, dict):
        return {}
    meta = item.get("metadata")
    if not isinstance(meta, dict):
        return {}
    re_data = meta.get("rule_engine", {})
    return re_data if isinstance(re_data, dict) else {}


def _safe_get(obj, key, default=None):
    """Safely get from dict-like objects."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return default


# ── BrandProfile ──────────────────────────────────────────────────────────────

class BrandProfile(BaseModel):
    name:              str       = ""
    mission_statement: str       = ""
    missionStatement:  str       = ""
    tone_settings:     dict      = Field(default_factory=dict)
    tone:              dict      = Field(default_factory=dict)
    preferred_terms:   list[str] = Field(default_factory=list)
    banned_phrases:    list[str] = Field(default_factory=list)
    key_messages:      list[str] = Field(default_factory=list)
    compliance_notes:  str       = ""
    industry:          str       = ""
    voice:             str       = ""
    target_audience:   str       = ""
    core_values:       list[str] = Field(default_factory=list)
    stands_for:        list[str] = Field(default_factory=list)
    stands_against:    list[str] = Field(default_factory=list)
    life_purpose:      str       = ""
    likes:             list[str] = Field(default_factory=list)
    hates:             list[str] = Field(default_factory=list)
    core_motivations:  list[str] = Field(default_factory=list)

    def as_dict(self) -> dict:
        d = self.model_dump()
        d["tone_settings"] = self.tone_settings or self.tone
        return d


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":      "ok",
        "version":     "3.1.0",
        "model":       os.getenv("OPENAI_MODEL", "unknown"),
        "environment": os.getenv("ENVIRONMENT", "development"),
    }


# ── Individual Agent Endpoints ────────────────────────────────────────────────

class CanonicalRequest(BaseModel):
    topic:           str
    objective:       str = "Build thought leadership"
    context:         str = ""
    audience:        str = "General Business"
    icp_description: str = ""
    perspective:     str = "Founder"
    structure:       str = "thesis"
    cta:             str = ""
    brandProfile:    Optional[BrandProfile] = None


@app.post("/agents/canonical-writer")
async def run_canonical_writer(req: CanonicalRequest):
    try:
        result = await run_with_timeout(
            canonical_writer.run(
                topic=req.topic,
                objective=req.objective,
                context=req.context,
                audience=req.audience,
                perspective=req.perspective,
                structure=req.structure,
                cta=req.cta,
            )
        )
        pv = await validate_and_fix(
            content=result["content"],
            agent_name="canonical_writer_direct",
        )
        result["content"]          = pv["content"]
        result["preGenValidation"] = {
            "false_negatives_found": pv["false_negatives_found"],
            "false_negatives_after": pv["false_negatives_after"],
            "fixed":                 pv["fixed"],
            "tokens_used":           pv["tokens_used"],
        }
        return result
    except HTTPException:
        raise
    except Exception as e:
        log.error("canonical_writer failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Canonical writer: {type(e).__name__}: {str(e)[:200]}")


class PlatformRequest(BaseModel):
    canonicalDraft: str
    targetPlatform: str
    audienceNote:   str = ""


@app.post("/agents/platform-optimizer")
async def run_platform_optimizer(req: PlatformRequest):
    try:
        return await run_with_timeout(
            platform_optimizer.run(req.canonicalDraft, req.targetPlatform)
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("platform_optimizer failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Platform optimizer: {type(e).__name__}: {str(e)[:200]}")


class BrandRequest(BaseModel):
    content:      str
    brandProfile: Optional[BrandProfile] = None


@app.post("/agents/brand-optimizer")
async def run_brand_optimizer(req: BrandRequest):
    try:
        return await run_with_timeout(
            brand_optimizer.run(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("brand_optimizer failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Brand optimizer: {type(e).__name__}: {str(e)[:200]}")


class HumanizeRequest(BaseModel):
    content:          str
    intensity:        str  = "medium"
    userPrompt:       str  = ""
    brandProfile:     Optional[BrandProfile] = None
    extraContext:     dict = Field(default_factory=dict)
    requestId:        str  = ""


@app.post("/agents/humanizer")
async def run_humanizer(req: HumanizeRequest):
    try:
        return await run_with_timeout(
            humanizer.run(
                content=req.content,
                intensity=req.intensity,
                user_prompt=req.userPrompt,
                brand_data=(
                    req.brandProfile.as_dict() if req.brandProfile else None
                ),
                extra_context=req.extraContext or None,
                request_id=req.requestId or None,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("humanizer failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Humanizer: {type(e).__name__}: {str(e)[:200]}")


class QARequest(BaseModel):
    content:      str
    brandProfile: Optional[BrandProfile] = None


@app.post("/agents/qa")
async def run_qa(req: QARequest):
    try:
        return await run_with_timeout(
            qa_agent.run(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("qa_agent failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"QA agent: {type(e).__name__}: {str(e)[:200]}")


class RuleEngineRequest(BaseModel):
    content:       str
    user_prompt:   str  = ""
    brandProfile:  Optional[BrandProfile] = None
    extra_context: Optional[dict] = None
    request_id:    Optional[str]  = None


@app.post("/agents/rule-engine")
async def run_rule_engine(req: RuleEngineRequest):
    try:
        orchestrator = RuleEngineOrchestrator()
        result = await run_with_timeout(
            orchestrator.process(
                content=req.content,
                user_prompt=req.user_prompt,
                brand_data=(
                    req.brandProfile.as_dict() if req.brandProfile else {}
                ),
                extra_context=req.extra_context,
                request_id=req.request_id,
            )
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        log.error("rule_engine failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Rule engine: {type(e).__name__}: {str(e)[:200]}")


class ScoreRequest(BaseModel):
    content:      str
    brandProfile: Optional[BrandProfile] = None


@app.post("/score")
async def run_score(req: ScoreRequest):
    try:
        return await run_with_timeout(
            score_content(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("scoring failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Scoring: {type(e).__name__}: {str(e)[:200]}")


# ── Full Pipeline ─────────────────────────────────────────────────────────────

class FullPipelineRequest(BaseModel):
    topic:                 str
    objective:             str       = "Build thought leadership"
    context:               str       = ""
    audience:              str       = "General Business"
    icp_description:       str       = ""
    perspective:           str       = "Founder"
    writing_structure:     str       = "thesis"
    cta:                   str       = ""
    targetPlatforms:       list[str] = Field(
        default_factory=lambda: ["linkedin_post"]
    )
    brandProfile:          Optional[BrandProfile] = None
    enableHumanization:    bool      = True
    humanizationIntensity: str       = "medium"
    enableQA:              bool      = True
    language:              str       = "English"
    keywords:              list[str] = Field(default_factory=list)
    specialInstructions:   str       = ""
    seoEnabled:            bool      = False
    seoSettings:           dict      = Field(default_factory=dict)


async def _safe_humanize(
    content: str,
    intensity: str,
    profile_dict: Optional[dict],
    req: FullPipelineRequest,
    platform: str,
) -> dict:
    """Call humanizer with defensive error handling. Falls back to input on failure."""
    try:
        return await humanizer.run(
            content=content,
            intensity=intensity,
            tonality=(profile_dict or {}).get("tone_settings"),
            language=req.language,
            brand_phrases=(profile_dict or {}).get("banned_phrases", []),
            user_prompt=req.topic,
            brand_data=profile_dict,
            extra_context={
                "platform":     platform,
                "objective":    req.objective,
                "content_type": "article",
                "keywords":     req.keywords,
                "cta":          req.cta,
            },
        )
    except Exception as e:
        log.error(
            "Humanizer failed for platform=%s | %s: %s\n%s",
            platform, type(e).__name__, e, traceback.format_exc()
        )
        # Fallback: return content unchanged with error metadata
        return {
            "content":    content,
            "tokensUsed": 0,
            "agent":      "humanizer",
            "intensity":  intensity,
            "metadata": {
                "error": f"{type(e).__name__}: {str(e)[:200]}",
                "fallback_used": True,
                "rule_engine": {"enabled": False, "reason": "humanizer_failed"},
            },
        }


async def _safe_qa(
    content: str,
    profile_dict: Optional[dict],
    seo_enabled: bool,
    seo_settings: dict,
    platform: str,
) -> dict:
    """Call QA with defensive error handling."""
    try:
        return await qa_agent.run(
            content=content,
            brand_profile=profile_dict,
            seo_enabled=seo_enabled,
            seo_settings=seo_settings,
        )
    except Exception as e:
        log.error(
            "QA failed for platform=%s | %s: %s",
            platform, type(e).__name__, e
        )
        return {
            "tokensUsed":   0,
            "overallScore": 0,
            "passed":       False,
            "error":        f"{type(e).__name__}: {str(e)[:200]}",
        }


# ── Refiner Endpoint ──────────────────────────────────────────────────────────

class RefineRequest(BaseModel):
    content:        str
    userPrompt:     str = ""
    quickTags:      list[str] = Field(default_factory=list)
    platform:       str = "linkedin_post"
    brandProfile:   Optional[BrandProfile] = None
    preserveLength: bool = False


@app.post("/agents/refiner")
async def run_refiner(req: RefineRequest):
    """Apply user-requested improvements to existing content."""
    try:
        return await run_with_timeout(
            refiner.run(
                original_content=req.content,
                user_prompt=req.userPrompt,
                quick_tags=req.quickTags,
                platform=req.platform,
                brand_profile=(
                    req.brandProfile.as_dict() if req.brandProfile and hasattr(req.brandProfile, "as_dict") else (req.brandProfile.dict() if req.brandProfile else None)
                ),
                preserve_length=req.preserveLength,
            ),
            timeout=120,  # Refinement is faster than full pipeline
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("refiner failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Refiner: {type(e).__name__}: {str(e)[:200]}"
        )


@app.post("/pipeline/run")
async def run_full_pipeline(req: FullPipelineRequest):
    """Full 5-agent pipeline with Pre-Gen Validation + Rule Engine."""

    async def _pipeline():
        pdl = PDLRequest(
            topic=req.topic,
            objective=req.objective,
            audience=req.audience,
            icp_description=req.icp_description,
            perspective=req.perspective,
            writing_structure=req.writing_structure,
            platforms=req.targetPlatforms,
            context=req.context,
            cta=req.cta,
            language=req.language,
            keywords=req.keywords,
            special_instructions=req.specialInstructions,
            enable_humanization=req.enableHumanization,
            humanization_intensity=req.humanizationIntensity,
            enable_qa=req.enableQA,
            brand_profile=(
                req.brandProfile.as_dict() if req.brandProfile else None
            ),
            seo_enabled=req.seoEnabled,
            seo_settings=req.seoSettings,
        )
        pkg = compile_prompt(pdl)

        log.info(
            "═══ Pipeline START | topic='%s' | platforms=%s | structure=%s ═══",
            req.topic[:50], req.targetPlatforms, req.writing_structure,
        )

        profile_dict = req.brandProfile.as_dict() if req.brandProfile else None
        total_tokens = 0

        # ── Agent 1: Canonical Writer ─────────────────────────────────────
        log.info("→ [1/5] Canonical Writer starting...")
        ci = pkg.canonical_instructions
        try:
            a1 = await canonical_writer.run(
                topic=ci["topic"],
                objective=ci["objective"],
                context=ci["context"],
                audience=ci["audience"],
                perspective=ci["perspective"],
                structure=ci["structure"],
                cta=ci["cta"],
                icp_emphasis=ci.get("icp_emphasis", ""),
                icp_avoid=ci.get("icp_avoid", ""),
                perspective_voice=ci.get("perspective_voice", ""),
                custom_structure_flow=ci.get("custom_structure_flow"),
                language=ci.get("language", "English"),
                word_count=ci.get("word_count"),
                special_instructions=ci.get("special_instructions", ""),
                tonality_spectrum=ci.get("tonality_spectrum") or {},
            )
        except Exception as e:
            log.error("Canonical writer FAILED: %s\n%s", e, traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Canonical writer failed: {type(e).__name__}: {str(e)[:200]}"
            )

        total_tokens   += a1["tokensUsed"]
        canonical_draft = a1["content"]
        log.info("✓ [1/5] Canonical done | tokens=%d | chars=%d",
                 a1["tokensUsed"], len(canonical_draft))

        # ── Pre-Gen Validation: Canonical draft ───────────────────────────
        try:
            pv_canonical = await validate_and_fix(
                content=canonical_draft,
                agent_name="canonical_writer",
                max_attempts=2,
            )
            canonical_draft  = pv_canonical["content"]
            total_tokens    += pv_canonical["tokens_used"]
        except Exception as e:
            log.warning("Pre-gen validation skipped: %s", e)
            pv_canonical = {
                "false_negatives_found": 0,
                "false_negatives_after": 0,
                "fixed": False,
                "tokens_used": 0,
            }

        # ── Agent 2: Platform Optimizer (parallel) ────────────────────────
        log.info("→ [2/5] Platform Optimizer starting for %d platforms...",
                 len(req.targetPlatforms))
        try:
            platform_results_raw = await asyncio.gather(*[
                platform_optimizer.run(
                    canonical_draft=canonical_draft,
                    target_platform=p,
                    audience_note=pkg.platform_instructions[p]["audience_note"],
                    word_count=pkg.platform_instructions[p]["word_count"],
                    seo_enabled=pkg.platform_instructions[p]["seo_enabled"],
                    seo_settings=pkg.platform_instructions[p]["seo_settings"],
                    cta=pkg.platform_instructions[p]["cta"],
                )
                for p in req.targetPlatforms
            ], return_exceptions=True)
        except Exception as e:
            log.error("Platform optimizer batch FAILED: %s\n%s", e, traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Platform optimizer failed: {type(e).__name__}: {str(e)[:200]}"
            )

        # Handle partial failures
        platform_results_clean = []
        for i, r in enumerate(platform_results_raw):
            if isinstance(r, Exception):
                log.error(
                    "Platform %s failed: %s: %s",
                    req.targetPlatforms[i], type(r).__name__, r
                )
                # Fallback: use canonical draft
                platform_results_clean.append({
                    "content":    canonical_draft,
                    "tokensUsed": 0,
                    "agent":      "platform_optimizer",
                    "platform":   req.targetPlatforms[i],
                    "error":      f"{type(r).__name__}: {str(r)[:200]}",
                })
            else:
                result: dict = r  # type: ignore[assignment]
                platform_results_clean.append(result)
                total_tokens += result.get("tokensUsed", 0)

        # ── Pre-Gen Validation: Platform results ──────────────────────────
        platform_results = []
        for i, r in enumerate(platform_results_clean):
            try:
                pv_plat = await validate_and_fix(
                    content=r["content"],
                    agent_name=f"platform_{req.targetPlatforms[i]}",
                    max_attempts=2,
                )
                platform_results.append({**r, "content": pv_plat["content"]})
                total_tokens += pv_plat["tokens_used"]
            except Exception as e:
                log.warning("Pre-gen validation for platform %s skipped: %s",
                            req.targetPlatforms[i], e)
                platform_results.append(r)

        log.info("✓ [2/5] Platform done | platforms=%d", len(platform_results))

        # ── Agent 3: Brand Optimizer (parallel) ──────────────────────────
        log.info("→ [3/5] Brand Optimizer starting...")
        try:
            brand_results_raw = await asyncio.gather(*[
                brand_optimizer.run(
                    content=r["content"],
                    brand_profile=profile_dict,
                )
                for r in platform_results
            ], return_exceptions=True)
        except Exception as e:
            log.error("Brand optimizer batch FAILED: %s\n%s", e, traceback.format_exc())
            raise HTTPException(
                status_code=500,
                detail=f"Brand optimizer failed: {type(e).__name__}: {str(e)[:200]}"
            )

        brand_results = []
        for i, r in enumerate(brand_results_raw):
            if isinstance(r, Exception):
                log.error(
                    "Brand optimizer failed for %s: %s: %s",
                    req.targetPlatforms[i], type(r).__name__, r
                )
                brand_results.append({
                    "content":    platform_results[i]["content"],
                    "tokensUsed": 0,
                    "error":      f"{type(r).__name__}: {str(r)[:200]}",
                })
            else:
                result: dict = r  # type: ignore[assignment]
                brand_results.append(result)
                total_tokens += result.get("tokensUsed", 0)

        log.info("✓ [3/5] Brand done")

        # ── Agent 4: Humanizer (parallel with fallback) ───────────────────
        if pkg.humanization_instructions["enabled"]:
            log.info("→ [4/5] Humanizer starting | intensity=%s...",
                     pkg.humanization_instructions["intensity"])
            intensity = pkg.humanization_instructions["intensity"]

            final_contents = await asyncio.gather(*[
                _safe_humanize(
                    content=r["content"],
                    intensity=intensity,
                    profile_dict=profile_dict,
                    req=req,
                    platform=req.targetPlatforms[i],
                )
                for i, r in enumerate(brand_results)
            ])
            for r in final_contents:
                total_tokens += r.get("tokensUsed", 0)
            log.info("✓ [4/5] Humanizer done")
        else:
            log.info("→ [4/5] Humanizer SKIPPED (disabled)")
            final_contents = [
                {"content": r["content"], "tokensUsed": 0, "metadata": {}}
                for r in brand_results
            ]

        # ── Agent 5: QA (parallel with fallback) ──────────────────────────
        qa_results: list[dict] = []
        if pkg.qa_instructions["enabled"]:
            log.info("→ [5/5] QA starting...")
            qa_results = await asyncio.gather(*[
                _safe_qa(
                    content=str(r["content"]),
                    profile_dict=profile_dict,
                    seo_enabled=req.seoEnabled,
                    seo_settings=req.seoSettings,
                    platform=req.targetPlatforms[i],
                )
                for i, r in enumerate(final_contents)
            ])
            for r in qa_results:
                total_tokens += r.get("tokensUsed", 0)
            log.info("✓ [5/5] QA done")
        else:
            log.info("→ [5/5] QA SKIPPED (disabled)")

        # ── Build artifacts ───────────────────────────────────────────────
        artifacts = []
        for i, platform in enumerate(req.targetPlatforms):
            qa_data = qa_results[i] if qa_results and i < len(qa_results) else {}
            artifacts.append({
                "platform":        platform,
                "finalContent":    final_contents[i].get("content", ""),
                "canonicalDraft":  canonical_draft,
                "platformVariant": platform_results[i].get("content", ""),
                "brandAligned":    brand_results[i].get("content", ""),
                "humanized":       final_contents[i].get("content", ""),
                "qa":              qa_data,
                "overallScore":    _safe_get(qa_data, "overallScore", 0),
                "passed":          _safe_get(qa_data, "passed", False),
                "ruleEngine":      _extract_rule_engine_meta(final_contents[i]),
                "preGenValidation": {
                    "canonical_false_negs_found": pv_canonical["false_negatives_found"],
                    "canonical_false_negs_after": pv_canonical["false_negatives_after"],
                    "canonical_fixed":            pv_canonical["fixed"],
                },
            })

        log.info(
            "═══ Pipeline COMPLETE | total_tokens=%d | artifacts=%d ═══",
            total_tokens, len(artifacts),
        )

        return {
            "artifacts":        artifacts,
            "canonicalDraft":   canonical_draft,
            "totalTokensUsed":  total_tokens,
            "compiledMetadata": pkg.metadata,
            "structureUsed":    a1.get("structure"),
            "structureFlow":    a1.get("structureFlow"),
        }

    try:
        return await run_with_timeout(_pipeline(), timeout=PIPELINE_TIMEOUT)
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        log.error(
            "Pipeline FATAL | type=%s | error=%s\n%s",
            type(e).__name__, e, tb
        )
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline failed: {type(e).__name__}: {str(e)[:300]}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENVIRONMENT") != "production",
        log_level=log_level.lower(),
    )