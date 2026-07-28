"""MCAP AI Engine — Production hardened FastAPI orchestrator."""
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

load_dotenv()

from agents import canonical_writer, platform_optimizer, brand_optimizer, humanizer, qa_agent
from agents.rule_engine import RuleEngineOrchestrator
from services.scoring import score as score_content
from services.prompt_compiler import PDLRequest, compile as compile_prompt

# ── Logging Setup ─────────────────────────────────────────────────────────────

log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ai-engine")

# ── Environment Validation ────────────────────────────────────────────────────

def validate_env() -> None:
    """Required env vars check karo startup pe."""
    required = ["OPENAI_API_KEY"]
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        raise EnvironmentError(f"Missing required env vars: {missing}")

# ── CORS Config ───────────────────────────────────────────────────────────────

def get_allowed_origins() -> list[str]:
    """
    AI Engine sirf API se call honi chahiye.
    CORS restrict karo.
    """
    origins = [
        "http://localhost:4000",
        "http://localhost:3000",
    ]
    
    # Render pe API service ka URL
    if api_host := os.getenv("ALLOWED_ORIGINS"):
        # Render host property comes without protocol
        if not api_host.startswith("http"):
            api_host = f"https://{api_host}"
        origins.append(api_host)
    
    # Render internal URLs allow karo
    # (*.onrender.com)
    return origins

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup aur shutdown events."""
    # Startup
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
    
    # Shutdown
    log.info("MCAP AI Engine shutting down")

# ── App Init ──────────────────────────────────────────────────────────────────

app = FastAPI(
    title="MCAP AI Engine",
    version="1.0.0",
    description="Multi-agent content pipeline for M-CAP Platform",
    lifespan=lifespan,
    # Production mein docs disable karo
    docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url=None,
)

# ── Middleware ────────────────────────────────────────────────────────────────

allowed_origins = get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.onrender\.com",  # Render subdomains
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)

# ── Request Logging ───────────────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time
    start = time.time()
    request_id = request.headers.get("X-Request-ID", "unknown")
    
    try:
        response = await call_next(request)
        duration = round((time.time() - start) * 1000, 2)
        
        if request.url.path != "/health":
            log.info(
                "%s %s | %d | %sms | req_id=%s",
                request.method,
                request.url.path,
                response.status_code,
                duration,
                request_id,
            )
        return response
    except Exception as e:
        duration = round((time.time() - start) * 1000, 2)
        log.error("Request failed: %s | %sms | req_id=%s", e, duration, request_id)
        raise

# ── Global Exception Handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled exception on %s: %s", request.url.path, exc)
    
    is_production = os.getenv("ENVIRONMENT") == "production"
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal server error" if is_production else str(exc),
            "path": str(request.url.path),
        }
    )

# ── Shared Models ─────────────────────────────────────────────────────────────

class BrandProfile(BaseModel):
    name: str = ""
    mission_statement: str = ""
    missionStatement: str = ""
    tone_settings: dict = Field(default_factory=dict)
    tone: dict = Field(default_factory=dict)
    preferred_terms: list[str] = Field(default_factory=list)
    banned_phrases: list[str] = Field(default_factory=list)
    key_messages: list[str] = Field(default_factory=list)
    compliance_notes: str = ""

    def as_dict(self) -> dict:
        d = self.model_dump()
        d["tone_settings"] = self.tone_settings or self.tone
        return d

# ── Health Check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "model": os.getenv("OPENAI_MODEL", "unknown"),
        "environment": os.getenv("ENVIRONMENT", "development"),
    }

# ── Pipeline Timeout Helper ───────────────────────────────────────────────────

PIPELINE_TIMEOUT = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "150"))

async def run_with_timeout(coro, timeout: int = PIPELINE_TIMEOUT):
    """Coroutine ko timeout ke saath run karo."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Operation timed out after {timeout}s"
        )

# ── Individual Agents ─────────────────────────────────────────────────────────

class CanonicalRequest(BaseModel):
    topic: str
    objective: str = "Build thought leadership"
    context: str = ""
    audience: str = "General Business"
    icp_description: str = ""
    perspective: str = "Founder"
    structure: str = "thesis"
    cta: str = ""
    brandProfile: Optional[BrandProfile] = None

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
        return result
    except HTTPException:
        raise
    except Exception as e:
        log.error("canonical_writer failed: %s", e)
        raise HTTPException(status_code=500, detail="Canonical writer failed")

class PlatformRequest(BaseModel):
    canonicalDraft: str
    targetPlatform: str
    audienceNote: str = ""

@app.post("/agents/platform-optimizer")
async def run_platform_optimizer(req: PlatformRequest):
    try:
        return await run_with_timeout(
            platform_optimizer.run(req.canonicalDraft, req.targetPlatform)
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("platform_optimizer failed: %s", e)
        raise HTTPException(status_code=500, detail="Platform optimizer failed")

class BrandRequest(BaseModel):
    content: str
    brandProfile: Optional[BrandProfile] = None

@app.post("/agents/brand-optimizer")
async def run_brand_optimizer(req: BrandRequest):
    try:
        return await run_with_timeout(
            brand_optimizer.run(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("brand_optimizer failed: %s", e)
        raise HTTPException(status_code=500, detail="Brand optimizer failed")

class HumanizeRequest(BaseModel):
    content: str
    intensity: str = "medium"

@app.post("/agents/humanizer")
async def run_humanizer(req: HumanizeRequest):
    try:
        return await run_with_timeout(
            humanizer.run(req.content, req.intensity)
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("humanizer failed: %s", e)
        raise HTTPException(status_code=500, detail="Humanizer failed")

class QARequest(BaseModel):
    content: str
    brandProfile: Optional[BrandProfile] = None

@app.post("/agents/qa")
async def run_qa(req: QARequest):
    try:
        return await run_with_timeout(
            qa_agent.run(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("qa_agent failed: %s", e)
        raise HTTPException(status_code=500, detail="QA agent failed")

class RuleEngineRequest(BaseModel):
    content: str
    user_prompt: str = ""
    brandProfile: Optional[BrandProfile] = None
    extra_context: Optional[dict] = None
    request_id: Optional[str] = None

@app.post("/agents/rule-engine")
async def run_rule_engine(req: RuleEngineRequest):
    try:
        orchestrator = RuleEngineOrchestrator()
        return await run_with_timeout(
            orchestrator.process(
                content=req.content,
                user_prompt=req.user_prompt,
                brand_data=req.brandProfile.as_dict() if req.brandProfile else None,
                extra_context=req.extra_context,
                request_id=req.request_id,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("rule_engine failed: %s", e)
        raise HTTPException(status_code=500, detail="Rule engine failed")

class ScoreRequest(BaseModel):
    content: str
    brandProfile: Optional[BrandProfile] = None

@app.post("/score")
async def run_score(req: ScoreRequest):
    try:
        return await run_with_timeout(
            score_content(
                req.content,
                req.brandProfile.as_dict() if req.brandProfile else None
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("scoring failed: %s", e)
        raise HTTPException(status_code=500, detail="Scoring failed")

# ── Full Pipeline ─────────────────────────────────────────────────────────────

class FullPipelineRequest(BaseModel):
    topic: str
    objective: str = "Build thought leadership"
    context: str = ""
    audience: str = "General Business"
    icp_description: str = ""
    perspective: str = "Founder"
    writing_structure: str = "thesis"
    cta: str = ""
    targetPlatforms: list[str] = Field(
        default_factory=lambda: ["linkedin_post"]
    )
    brandProfile: Optional[BrandProfile] = None
    enableHumanization: bool = True
    humanizationIntensity: str = "medium"
    enableQA: bool = True
    language: str = "English"
    keywords: list[str] = Field(default_factory=list)
    specialInstructions: str = ""
    seoEnabled:  bool = False
    seoSettings: dict = Field(default_factory=dict)

@app.post("/pipeline/run")
async def run_full_pipeline(req: FullPipelineRequest):
    """
    Full 5-agent pipeline with 90s timeout.
    Platform optimization parallel mein hoti hai.
    """
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
            brand_profile=req.brandProfile.as_dict() if req.brandProfile else None,
            seo_enabled=req.seoEnabled,
            seo_settings=req.seoSettings,
        )
        pkg = compile_prompt(pdl)
        log.info(
            "Pipeline start | topic='%s' | platforms=%s | structure=%s",
            req.topic[:50],
            req.targetPlatforms,
            req.writing_structure,
        )

        profile_dict = req.brandProfile.as_dict() if req.brandProfile else None
        total_tokens = 0

        # Agent 1: Canonical Writer
        ci = pkg.canonical_instructions
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
            tonality_spectrum=ci.get("tonality_spectrum"),
        )
        total_tokens += a1["tokensUsed"]
        canonical_draft = a1["content"]
        log.info("Agent 1 (canonical) done | tokens=%d", a1["tokensUsed"])

        # Agent 2: Platform Optimizer (parallel)
        platform_results = await asyncio.gather(*[
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
        ])
        for r in platform_results:
            total_tokens += r["tokensUsed"]
        log.info("Agent 2 (platform) done | platforms=%d", len(platform_results))

        # Agent 3: Brand Optimizer (parallel)
        brand_results = await asyncio.gather(*[
            brand_optimizer.run(content=r["content"], brand_profile=profile_dict)
            for r in platform_results
        ])
        for r in brand_results:
            total_tokens += r["tokensUsed"]
        log.info("Agent 3 (brand) done")

        # Agent 4: Humanizer (parallel, if enabled)
        if pkg.humanization_instructions["enabled"]:
            intensity = pkg.humanization_instructions["intensity"]
            final_contents = await asyncio.gather(*[
                humanizer.run(
                    content=r["content"],
                    intensity=intensity,
                    tonality=req.brandProfile.as_dict().get("tone_settings") if req.brandProfile else None,
                    language=req.language,
                    brand_phrases=req.brandProfile.as_dict().get("banned_phrases", []) if req.brandProfile else [],
                )
                for r in brand_results
            ])
            for r in final_contents:
                total_tokens += r["tokensUsed"]
            log.info("Agent 4 (humanize) done | intensity=%s", intensity)
        else:
            final_contents = [
                {"content": r["content"], "tokensUsed": 0}
                for r in brand_results
            ]

        # Agent 5: QA (parallel, if enabled)
        qa_results = []
        if pkg.qa_instructions["enabled"]:
            qa_results = await asyncio.gather(*[
                qa_agent.run(
                    content=r["content"],
                    brand_profile=profile_dict,
                    seo_enabled=getattr(req, 'seoEnabled', False),
                    seo_settings=getattr(req, 'seoSettings', {}),
                )
                for r in final_contents
            ])
            for r in qa_results:
                total_tokens += r["tokensUsed"]
            log.info("Agent 5 (qa) done")

        # Final output build karo
        artifacts = [
            {
                "platform": platform,
                "finalContent": final_contents[i]["content"],
                "canonicalDraft": canonical_draft,
                "platformVariant": platform_results[i]["content"],
                "brandAligned": brand_results[i]["content"],
                "humanized": final_contents[i]["content"],
                "qa": qa_results[i] if qa_results else {},
                "overallScore": qa_results[i].get("overallScore", 0) if qa_results else 0,
                "passed": qa_results[i].get("passed", False) if qa_results else False,
            }
            for i, platform in enumerate(req.targetPlatforms)
        ]

        log.info(
            "Pipeline complete | total_tokens=%d | artifacts=%d",
            total_tokens,
            len(artifacts),
        )

        return {
            "artifacts": artifacts,
            "canonicalDraft": canonical_draft,
            "totalTokensUsed": total_tokens,
            "compiledMetadata": pkg.metadata,
            "structureUsed": a1.get("structure"),
            "structureFlow": a1.get("structureFlow"),
        }

    try:
        return await run_with_timeout(_pipeline(), timeout=PIPELINE_TIMEOUT)
    except HTTPException:
        raise
    except Exception as e:
        log.error("Pipeline failed: %s", e)
        raise HTTPException(status_code=500, detail="Pipeline execution failed")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENVIRONMENT") != "production",
        log_level=log_level.lower(),
    )
