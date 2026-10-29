"""Step-by-step agent walkthrough with a review gate between agents.

Runs the pipeline one agent at a time, the way /pipeline/run wires them, and
appends each step to a Markdown report: the output, objective checks on it, and
proof of what brand data reached the agent's prompts.

    python scripts/walkthrough.py init  --run zomato --pdf brand.pdf
    python scripts/walkthrough.py run   --run zomato 1
    python scripts/walkthrough.py verdict --run zomato 1 approve "reads well"
    python scripts/walkthrough.py run   --run zomato 2
    ...

Each `run N` takes the latest output of step N-1 as its input. Steps:
  1 canonical writer (+ pre-gen validation)   4 humanizer (rule engine OFF)
  2 platform optimizer (+ brief, validation)  5 rule engine on its own
  3 brand optimizer                            6 QA

Calls the real LLM providers configured in .env, so every step costs tokens.
"""
import argparse
import asyncio
import difflib
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # apps/ai-engine
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

for _env in (ROOT / ".env", ROOT.parents[1] / ".env"):
    if _env.exists():
        load_dotenv(_env)
        break

RUNS = ROOT / "eval" / "walkthrough"
STEP_NAMES = {
    1: "Canonical Writer", 2: "Platform Optimizer", 3: "Brand Optimizer",
    4: "Humanizer (rule engine off)", 5: "Rule Engine", 6: "QA Agent",
}

# ── Test brand configuration ──────────────────────────────────────────────────
# The PDF supplies document_context. Everything else is what the brand form
# would hold, derived from the PDF so the checks have something to look for.
DEFAULT_CFG = {
    "topic": "How a menu directory turned into everyday food delivery, and what founders can take from it",
    "objective": "Build thought leadership",
    "audience": "Founders / Entrepreneurs",
    "perspective": "Brand",
    "writing_structure": "case_study",
    "platform": "linkedin_post",
    "word_count": 350,
    "cta": "invite_discussion",
    "humanization_intensity": "medium",
    "language": "English",
    "tonality_spectrum": {},
    "profile": {
        "name": "Zomato",
        "industry": "Food delivery / food-tech",
        "target_audience": "Urban Indian consumers, restaurant partners, founders and product teams",
        "voice": "Conversational, witty and culturally aware in marketing; clear and empathetic on service and safety",
        "mission_statement": "Better food for more people",
        "tone_settings": {
            "formality": 3, "confidence": 8, "technical": 3, "humor": 7,
            "enthusiasm": 8, "empathy": 6, "storytelling": 7,
        },
        "preferred_terms": ["delivery partners", "restaurant partners", "Eternal Limited"],
        "banned_phrases": ["delivery boys", "game-changing", "disrupt", "unbeatable"],
        "compliance_notes": (
            "Do not present figures that are not in the brand document. Zomato is the consumer "
            "brand and Eternal Limited is the listed parent: never conflate them. No investment "
            "advice. State the fiscal year with any metric. EV (2030) and net-zero (2033) are "
            "targets, not achievements."
        ),
        "key_messages": ["Better food for more people", "Operations are part of the product"],
    },
}

# Snippets from early, middle and late in the PDF, to see how far into the
# document each agent's prompt reaches.
FACT_MARKERS = ["Foodiebay", "979 million", "Eternal Limited", "Blinkit", "Deepinder Goyal",
                "Better food for more people", "net-zero", "Healthy Mode", "Feeding India"]

# What each tone slider renders as, per agent, so a hit means the tone arrived.
BRAND_TONE_MARKERS = ["Conversational and approachable", "Authoritative", "Light humor",
                      "Narrative and story-driven", "TONE TO MAINTAIN", "Declarative statements",
                      "Light wordplay", "Warmer language", "Varied punctuation"]


# ── LLM call recorder ─────────────────────────────────────────────────────────

CALLS: list[dict] = []
CURRENT = {"step": None}


def install_recorder() -> None:
    """Wrap every module's `complete` so each prompt and reply is kept."""
    import services.llm as llm
    import main  # noqa: F401  (imports every agent module)
    import agents.humanizer, agents.rule_engine.orchestrator  # noqa: F401

    orig = llm.complete

    # `complete` picks a provider internally and falls back silently, so record
    # which provider call actually succeeded (or failed) inside each call.
    provider_log: list[tuple[str, str]] = []

    def track(fn, label):
        async def inner(*a, **kw):
            try:
                res = await fn(*a, **kw)
            except Exception as e:
                provider_log.append((label, f"failed: {type(e).__name__}"))
                raise
            provider_log.append((label, "ok"))
            return res
        return inner

    llm.complete_openai = track(llm.complete_openai, f"{llm.OPENAI_MODEL} via {llm.OPENAI_BASE_URL or 'openai'}")
    llm.complete_claude = track(llm.complete_claude, f"{llm.CLAUDE_MODEL} via anthropic")

    def served_by(since: int) -> str:
        used = provider_log[since:]
        ok = [p for p, s in used if s == "ok"]
        failed = [p for p, s in used if s != "ok"]
        label = ok[-1] if ok else "none"
        return label + (f" (after failure of {', '.join(failed)})" if failed and ok else "")

    def make(mod_name):
        async def wrapper(system, user, *a, **kw):
            t0 = time.time()
            since = len(provider_log)
            try:
                text, tokens = await orig(system, user, *a, **kw)
            except Exception as e:
                CALLS.append({"step": CURRENT["step"], "module": mod_name, "system": system,
                              "user": user, "response": "", "tokens": 0, "provider": served_by(since),
                              "secs": round(time.time() - t0, 1), "error": f"{type(e).__name__}: {e}"})
                raise
            CALLS.append({"step": CURRENT["step"], "module": mod_name, "system": system,
                          "user": user, "response": text, "tokens": tokens, "provider": served_by(since),
                          "secs": round(time.time() - t0, 1), "error": None})
            return text, tokens
        return wrapper

    for name, mod in list(sys.modules.items()):
        if name != "services.llm" and getattr(mod, "complete", None) is orig:
            setattr(mod, "complete", make(name.split(".")[-1]))


# ── State ─────────────────────────────────────────────────────────────────────

def paths(run: str) -> dict:
    d = RUNS / run
    return {"dir": d, "state": d / "state.json", "report": d / "report.md",
            "prompts": d / "prompts", "doc": d / "brand_document.txt"}


def load_state(run: str) -> dict:
    p = paths(run)["state"]
    if not p.exists():
        sys.exit(f"No run '{run}'. Start with: init --run {run} --pdf <file>")
    return json.loads(p.read_text(encoding="utf-8"))


def save_state(run: str, st: dict) -> None:
    paths(run)["state"].write_text(json.dumps(st, indent=2, ensure_ascii=False), encoding="utf-8")


def append_report(run: str, md: str) -> None:
    with open(paths(run)["report"], "a", encoding="utf-8") as f:
        f.write(md.rstrip() + "\n\n")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


# ── Brand profile / pipeline wiring ───────────────────────────────────────────

def build_profile(st: dict) -> dict:
    """Run the profile through the real BrandProfile model, as the API route does."""
    from main import BrandProfile
    doc = paths(st["run"])["doc"].read_text(encoding="utf-8")
    return BrandProfile(**st["cfg"]["profile"], document_context=doc).as_dict()


def build_pkg(st: dict, profile: dict):
    from services.prompt_compiler import PDLRequest, compile as compile_prompt
    c = st["cfg"]
    return compile_prompt(PDLRequest(
        topic=c["topic"], objective=c["objective"], audience=c["audience"],
        perspective=c["perspective"], writing_structure=c["writing_structure"],
        platforms=[c["platform"]], cta=c["cta"], language=c["language"],
        enable_humanization=True, humanization_intensity=c["humanization_intensity"],
        enable_qa=True, brand_profile=profile,
        tonality_spectrum=c.get("tonality_spectrum") or {}, word_count=c["word_count"],
    ))


# ── Objective checks on an output ─────────────────────────────────────────────

def metrics(text: str, doc: str, profile: dict) -> dict:
    from services.tells import tell_report
    words = re.findall(r"[\w'’-]+", text)
    sents = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
    lens = [len(re.findall(r"[\w'’-]+", s)) for s in sents] or [0]
    low = text.lower()
    doc_n = norm(doc)

    nums = set(re.findall(r"\d[\d,]*\.?\d*", text))
    unsupported = sorted(n for n in nums if n.rstrip(".,") not in doc_n and len(n.rstrip(".,")) >= 2)

    return {
        "words": len(words),
        "sentences": len(sents),
        "avg_sentence_words": round(sum(lens) / len(lens), 1),
        "exclamations": text.count("!"),
        "questions": text.count("?"),
        "emoji": len(re.findall(r"[\U0001F300-\U0001FAFF☀-➿]", text)),
        "tells_effective": tell_report(text)["effective_count"],
        "banned_hits": [b for b in profile.get("banned_phrases", []) if b.lower() in low],
        "preferred_used": [t for t in profile.get("preferred_terms", []) if t.lower() in low],
        "doc_facts_used": [m for m in FACT_MARKERS if m.lower() in low],
        "numbers_not_in_brand_doc": unsupported,
    }


def injection_report(calls: list[dict], doc: str, profile: dict, tonality: dict) -> list[dict]:
    """For each LLM call in a step: which brand inputs are visible in its prompt."""
    doc_n = norm(doc)
    samples = [doc_n[i:i + 50] for i in range(0, max(len(doc_n) - 50, 1), max(len(doc_n) // 25, 1))]
    comp = norm(profile.get("compliance_notes", ""))[:40]
    rows = []
    for c in calls:
        p = norm(c["system"] + " " + c["user"])
        banned = profile.get("banned_phrases", [])
        pref = profile.get("preferred_terms", [])
        rows.append({
            "module": c["module"],
            "doc_coverage_pct": round(100 * sum(s in p for s in samples) / len(samples)),
            "banned": f"{sum(b.lower() in p for b in banned)}/{len(banned)}",
            "preferred": f"{sum(t.lower() in p for t in pref)}/{len(pref)}",
            "compliance": bool(comp and comp in p),
            "brand_tone_markers": [m for m in BRAND_TONE_MARKERS if m.lower() in p],
            "piece_tonality": "tonality spectrum for this piece" in p if tonality else None,
            "verified_facts": "verified" in p,
            "tokens": c["tokens"],
            "provider": c.get("provider", "?"),
            "secs": c["secs"],
            "error": c["error"],
        })
    return rows


def fmt_metrics(m: dict) -> str:
    return "\n".join(f"| {k} | {v if v not in ([], '') else '—'} |" for k, v in m.items())


def fmt_injection(rows: list[dict]) -> str:
    if not rows:
        return "_No LLM calls were made in this step._"
    head = ("| LLM call (module) | brand doc seen | banned | preferred | compliance | brand tone | "
            "piece tonality | facts block | tokens | s | served by |\n|---|---|---|---|---|---|---|---|---|---|---|\n")
    body = "\n".join(
        f"| {r['module']} | {r['doc_coverage_pct']}% | {r['banned']} | {r['preferred']} | "
        f"{'yes' if r['compliance'] else 'NO'} | {', '.join(r['brand_tone_markers']) or 'NO'} | "
        f"{'n/a' if r['piece_tonality'] is None else ('yes' if r['piece_tonality'] else 'NO')} | "
        f"{'yes' if r['verified_facts'] else 'no'} | {r['tokens']} | {r['secs']} | {r['provider']} |"
        + (f" **ERROR: {r['error']}**" if r["error"] else "")
        for r in rows)
    return head + body


def diff_block(before: str, after: str) -> str:
    a = re.split(r"(?<=[.!?])\s+|\n", before)
    b = re.split(r"(?<=[.!?])\s+|\n", after)
    d = [l for l in difflib.unified_diff(a, b, lineterm="", n=0) if not l.startswith(("---", "+++", "@@"))]
    return "```diff\n" + "\n".join(d) + "\n```" if d else "_No change._"


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_init(a) -> None:
    import pymupdf
    p = paths(a.run)
    p["dir"].mkdir(parents=True, exist_ok=True)
    p["prompts"].mkdir(exist_ok=True)

    doc = "\n".join(pg.get_text() for pg in pymupdf.open(a.pdf))
    p["doc"].write_text(doc, encoding="utf-8")

    cfg = json.loads(json.dumps(DEFAULT_CFG))
    if a.cfg:
        cfg.update(json.loads(Path(a.cfg).read_text(encoding="utf-8")))
    st = {"run": a.run, "cfg": cfg, "steps": {}, "created": datetime.now().isoformat(timespec="seconds")}
    save_state(a.run, st)

    profile = build_profile(st)
    pkg = build_pkg(st, profile)
    from agents.rule_engine.agents.dynamic_rule_gen import DynamicRuleGeneratorAgent
    from agents.rule_engine.orchestrator import RuleEngineOrchestrator
    from services.verified_facts import build_verified_facts
    from services.voice import measure, describe
    c = cfg

    extra = {"platform": c["platform"], "objective": c["objective"], "content_type": "article",
             "keywords": [], "cta": c["cta"]}
    rule_ctx = DynamicRuleGeneratorAgent()._build_context(c["topic"], profile, extra)
    dyn_ctx = RuleEngineOrchestrator._extract_dynamic_context(
        RuleEngineOrchestrator.__new__(RuleEngineOrchestrator),
        type("D", (), {})(), profile, extra)
    facts = build_verified_facts(profile)
    voice = describe(measure(doc)) or "(document too short to measure)"

    supplied = {k: v for k, v in c["profile"].items() if v}
    lost = [k for k in supplied if not profile.get(k)]

    append_report(a.run, f"""# Agent walkthrough report: {c['profile']['name']}

Started {st['created']} · brand document: `{Path(a.pdf).name}` ({len(doc):,} characters) · every step is reviewed before the next runs.

## Test configuration

| Setting | Value |
|---|---|
| Topic | {c['topic']} |
| Platform | {c['platform']} (~{c['word_count']} words) |
| Audience / perspective / structure | {c['audience']} / {c['perspective']} / {c['writing_structure']} |
| CTA / humanizer intensity | {c['cta']} / {c['humanization_intensity']} |
| Per-piece tonality spectrum | {c['tonality_spectrum'] or '(none; baseline run)'} |
| Brand tone sliders (0-10) | {c['profile']['tone_settings']} |
| Preferred terms | {', '.join(c['profile']['preferred_terms'])} |
| Banned phrases | {', '.join(c['profile']['banned_phrases'])} |
| Compliance notes | {c['profile']['compliance_notes']} |

The brand name, tone sliders, preferred and banned terms and compliance notes were written for this test, derived from the PDF. The PDF itself is the document context.

## Step 0: brand data injection preflight (no LLM, deterministic)

**Profile survives `BrandProfile` model:** {'all supplied fields kept' if not lost else 'LOST: ' + ', '.join(lost)}

**How much of the document each agent can see** (document is {len(doc):,} chars):

| Consumer | Limit in code | Share of document |
|---|---|---|
| Canonical writer | first 12,000 chars (document + facts block share it) | {min(100, round(1200000 / len(doc)))}% |
| Brand optimizer | first 6,000 chars | {min(100, round(600000 / len(doc)))}% |
| Humanizer | document used only to measure rhythm | n/a |
| Platform optimizer | receives only a measured-rhythm summary, not the document | n/a |

**Voice target measured from the document:**

> {voice.replace(chr(10), chr(10) + '> ')}

**Facts block (`build_verified_facts`), {len(facts):,} chars:**

```
{facts[:1500] or '(empty)'}
```

**What the rule engine's dynamic-rule generator receives** (this is everything it can base brand rules on):

```json
{json.dumps(rule_ctx, indent=2, ensure_ascii=False)}
```

**Context the rule engine hands its regeneration agent:**

```json
{json.dumps(dyn_ctx, indent=2, ensure_ascii=False)}
```
""")
    print(f"Run '{a.run}' initialised. Document {len(doc):,} chars. Report: {p['report']}")
    print("\nrule-gen context keys under brand:", sorted(rule_ctx["brand"]))
    print("regen dynamic context:", dyn_ctx)
    print("lost fields:", lost or "none")


async def run_step(st: dict, n: int, feedback: str) -> dict:
    from agents import canonical_writer, platform_optimizer, brand_optimizer, humanizer, qa_agent
    from agents.rule_engine import RuleEngineOrchestrator
    from services.pre_generation_validator import validate_and_fix
    from services.verified_facts import build_verified_facts
    from services import format_specs

    c = st["cfg"]
    profile = build_profile(st)
    pkg = build_pkg(st, profile)
    prev = st["steps"].get(str(n - 1), {}).get("output") if n > 1 else None
    if n > 1 and not prev:
        sys.exit(f"Step {n - 1} has no output yet.")
    platform = c["platform"]
    extra: dict = {}
    t0 = time.time()

    if n == 1:
        ci = pkg.canonical_instructions
        special = ci.get("special_instructions", "")
        if feedback:
            special = (special + "\n\nREVIEWER FEEDBACK ON THE PREVIOUS DRAFT:\n" + feedback).strip()
        r = await canonical_writer.run(
            topic=ci["topic"], objective=ci["objective"], context=ci["context"],
            audience=ci["audience"], perspective=ci["perspective"], structure=ci["structure"],
            cta=ci["cta"], icp_emphasis=ci.get("icp_emphasis", ""), icp_avoid=ci.get("icp_avoid", ""),
            perspective_voice=ci.get("perspective_voice", ""),
            custom_structure_flow=ci.get("custom_structure_flow"), language=ci.get("language", "English"),
            word_count=ci.get("word_count"), special_instructions=special,
            tonality_spectrum=ci.get("tonality_spectrum") or {},
            brand_document_context=ci.get("brand_document_context", ""),
            verified_profile_facts=build_verified_facts(profile),
            compliance_notes=ci.get("compliance_notes", ""),
            preferred_terms=ci.get("preferred_terms") or [],
            brand_tone=ci.get("brand_tone") or {},
            banned_phrases=ci.get("banned_phrases") or [],
        )
        pv = await validate_and_fix(content=r["content"], agent_name="canonical_writer", max_attempts=2)
        extra = {"raw_agent_output": r["content"], "structure": r.get("structure"),
                 "pre_gen_validation": {k: pv[k] for k in
                                        ("false_negatives_found", "false_negatives_after", "fixed")}}
        out = pv["content"]

    elif n == 2:
        brief, _ = await platform_optimizer.build_brief(prev)
        from services.voice import measure, describe
        voice_target = describe(measure(profile.get("document_context", "")))
        pi = pkg.platform_instructions[platform]
        from services.verified_facts import build_brand_rules
        cap = format_specs.get_spec(platform).max_words
        platform_words = min(pi["word_count"], cap) if pi["word_count"] and cap else pi["word_count"]
        # Same inputs main.py passes: the raw request context and special instructions.
        must = "\n".join(x.strip() for x in (c.get("context", ""), c.get("special_instructions", "")) if x and x.strip())[:2000]
        r = await platform_optimizer.run(
            canonical_draft=prev, target_platform=platform, audience_note=pi["audience_note"],
            word_count=platform_words, seo_enabled=pi["seo_enabled"], seo_settings=pi["seo_settings"],
            cta=pi["cta"], must_preserve=must, brief=brief, voice_target=voice_target,
            brand_rules=build_brand_rules(profile))
        pv = await validate_and_fix(content=r["content"], agent_name=f"platform_{platform}", max_attempts=2)
        extra = {"brief": brief, "voice_target_sent": voice_target,
                 "format_issues_after": format_specs.check(platform, pv["content"], source=prev)}
        out = pv["content"]

    elif n == 3:
        r = await brand_optimizer.run(content=prev, brand_profile=profile, platform=platform)
        out = r["content"]
        extra = {k: v for k, v in r.items() if k not in ("content",)}

    elif n == 4:
        r = await humanizer.run(
            content=prev, intensity=c["humanization_intensity"], tonality=profile.get("tone_settings"),
            language=c["language"], brand_phrases=profile.get("banned_phrases", []),
            user_prompt=c["topic"], brand_data=profile,
            extra_context={"platform": platform, "objective": c["objective"], "content_type": "article",
                           "keywords": [], "cta": c["cta"], "skip_rule_engine": True})
        out = r["content"]
        extra = {"humanizer_metadata": r.get("metadata")}

    elif n == 5:
        re_res = await RuleEngineOrchestrator().process(
            content=prev, user_prompt=c["topic"], brand_data=profile,
            extra_context={"platform": platform, "objective": c["objective"], "content_type": "article",
                           "keywords": [], "cta": c["cta"]})
        out = format_specs.enforce_hard_limits(platform, re_res.final_content)
        v = re_res.static_validation
        extra = {
            "final_score": re_res.final_score, "passed": v.passed, "iterations": re_res.total_iterations,
            "static_score": v.static_score, "dynamic_score": v.dynamic_score,
            "improvement_log": re_res.improvement_log, "critical_failures": v.critical_failures,
            "violations": [x.model_dump(mode="json") for x in v.violations],
            "dynamic_rules": [r_.model_dump(mode="json") for r_ in re_res.dynamic_rules.rules],
            "dynamic_rules_context": re_res.dynamic_rules.context_used,
            "category_breakdown": v.category_breakdown,
        }

    elif n == 6:
        r = await qa_agent.run(content=prev, brand_profile=profile, seo_enabled=False,
                               seo_settings={}, platform=platform)
        out = prev
        extra = {"qa": r}
    else:
        sys.exit("Steps are 1-6.")

    return {"output": out, "input": prev, "extra": extra, "secs": round(time.time() - t0, 1),
            "feedback": feedback, "profile": profile}


def cmd_run(a) -> None:
    st = load_state(a.run)
    n = a.step
    p = paths(a.run)
    doc = p["doc"].read_text(encoding="utf-8")
    install_recorder()
    CURRENT["step"] = n
    start = len(CALLS)
    try:
        res = asyncio.run(run_step(st, n, a.feedback or ""))
    except Exception as e:
        calls = CALLS[start:]
        append_report(a.run, f"## Step {n}: {STEP_NAMES[n]}\n\n**FAILED**: `{type(e).__name__}: {e}`\n\n"
                      f"LLM calls before failure: {len(calls)}. " +
                      "; ".join(f"{c['module']}: {c['error'] or 'ok'}" for c in calls))
        raise

    calls = CALLS[start:]
    profile = res.pop("profile")
    m = metrics(res["output"], doc, profile)
    inj = injection_report(calls, doc, profile, st["cfg"].get("tonality_spectrum") or {})

    step = st["steps"].setdefault(str(n), {"attempts": []})
    step["attempts"].append({"output": res["output"], "extra": res["extra"], "metrics": m,
                             "injection": inj, "feedback": res["feedback"], "verdict": None})
    step["output"] = res["output"]
    save_state(a.run, st)

    attempt = len(step["attempts"])
    (p["prompts"] / f"step{n}_attempt{attempt}.md").write_text(
        "\n\n".join(f"# {c['module']}\n\n## SYSTEM\n\n{c['system']}\n\n## USER\n\n{c['user']}\n\n"
                    f"## RESPONSE\n\n{c['response']}" for c in calls), encoding="utf-8")

    md = [f"## Step {n}: {STEP_NAMES[n]}" + (f" (attempt {attempt})" if attempt > 1 else ""),
          f"_{datetime.now().strftime('%H:%M:%S')} · {res['secs']}s · {len(calls)} LLM calls · "
          f"{sum(c['tokens'] for c in calls)} tokens · full prompts: `prompts/step{n}_attempt{attempt}.md`_"]
    if res["feedback"]:
        md.append(f"**Reviewer feedback applied:** {res['feedback']}")
    if n > 1:
        md.append("**Input** (approved output of the previous step):\n\n" +
                  "\n".join("> " + l for l in res["input"].splitlines()))
    md.append("**Output**\n\n" + "\n".join("> " + l for l in res["output"].splitlines()))
    if n > 1 and n != 6:
        md.append("**What this agent changed**\n\n" + diff_block(res["input"], res["output"]))
    md.append("**Objective checks on the output**\n\n| Check | Result |\n|---|---|\n" + fmt_metrics(m))
    md.append("**Brand data visible in this step's prompts**\n\n" + fmt_injection(inj))
    ex = res["extra"]
    if n == 1:
        md.append(f"**Pre-gen validation:** {ex['pre_gen_validation']}")
    if n == 2:
        md.append(f"**Format issues remaining:** {ex['format_issues_after'] or 'none'}\n\n"
                  f"**Voice target sent to platform optimizer:** {ex['voice_target_sent'] or '(none)'}")
    if n == 4:
        md.append(f"**Humanizer metadata:** `{json.dumps(ex['humanizer_metadata'], default=str)}`")
    if n == 5:
        before = metrics(res["input"], doc, profile)["tells_effective"]
        md.append(
            f"**Rule engine result:** score {ex['final_score']} · passed {ex['passed']} · "
            f"iterations {ex['iterations']} · static {ex['static_score']} · dynamic {ex['dynamic_score']} · "
            f"tells {before} → {m['tells_effective']}\n\n"
            "**Iteration log**\n\n| iter | score | static | dynamic | passed | violations | critical |\n"
            "|---|---|---|---|---|---|---|\n" +
            "\n".join(f"| {i['iteration']} | {i['score']:.1f} | {i['static_score']:.1f} | "
                      f"{i['dynamic_score']:.1f} | {i['passed']} | {i['total_violations']} | "
                      f"{', '.join(i['critical_failures']) or '—'} |" for i in ex["improvement_log"]) +
            "\n\n**Dynamic rules generated for this brand/request**\n\n| id | category | severity | name | instruction |\n"
            "|---|---|---|---|---|\n" +
            "\n".join(f"| {r['id']} | {r['category']} | {r['severity']} | {r['name']} | "
                      f"{r['instruction'][:160]} |" for r in ex["dynamic_rules"]) +
            "\n\n**Violations still open at the end**\n\n" +
            ("\n".join(f"- `{v['rule_id']}` {v['rule_name']} ({v['severity']}): {v['description'][:180]}"
                       for v in ex["violations"]) or "none"))
    if n == 6:
        q = ex["qa"]
        md.append("**QA result**\n\n```json\n" + json.dumps(q, indent=2, ensure_ascii=False, default=str)[:4000] + "\n```")
    md.append("**Reviewer verdict:** _pending_")
    append_report(a.run, "\n\n".join(md))

    print(f"=== STEP {n}: {STEP_NAMES[n]} (attempt {attempt}) | {res['secs']}s | "
          f"{sum(c['tokens'] for c in calls)} tokens ===\n")
    print(res["output"])
    print("\n--- checks ---")
    for k, v in m.items():
        print(f"{k}: {v}")
    print("\n--- brand data in prompts ---")
    for r in inj:
        print(f"{r['module']}: doc {r['doc_coverage_pct']}% | banned {r['banned']} | preferred {r['preferred']} | "
              f"compliance {r['compliance']} | tone {r['brand_tone_markers'] or 'NONE'} | "
              f"piece_tonality {r['piece_tonality']} | served_by {r['provider']} | err {r['error']}")
    if n == 5:
        print("\n--- rule engine ---")
        print(f"score {ex['final_score']} passed {ex['passed']} iterations {ex['iterations']}")
        print("dynamic rules:", [r["name"] for r in ex["dynamic_rules"]])
        print("rule-gen context brand keys:", sorted(ex["dynamic_rules_context"].get("brand", {})))
        for i in ex["improvement_log"]:
            print(f"  iter {i['iteration']}: {i['score']:.1f} violations={i['total_violations']}")
    if n == 6:
        print(json.dumps({k: v for k, v in ex["qa"].items() if k != "content"},
                         indent=2, ensure_ascii=False, default=str)[:2500])


def cmd_verdict(a) -> None:
    st = load_state(a.run)
    step = st["steps"].get(str(a.step))
    if not step:
        sys.exit(f"Step {a.step} has not been run.")
    step["attempts"][-1]["verdict"] = {"decision": a.decision, "note": a.note or ""}
    save_state(a.run, st)
    mark = {"approve": "APPROVED", "revise": "REVISION REQUESTED"}[a.decision]
    append_report(a.run, f"**Reviewer verdict, step {a.step}: {mark}**" + (f" — {a.note}" if a.note else ""))
    print(f"Step {a.step}: {mark}")


CASUAL = {"formality": 3, "confidence": 8, "technical": 3, "humor": 7, "enthusiasm": 8, "empathy": 6, "storytelling": 7}
FORMAL = {"formality": 9, "confidence": 8, "technical": 6, "humor": 1, "enthusiasm": 2, "empathy": 4, "storytelling": 3}
EXTREME = {"formality": 1, "confidence": 9, "technical": 2, "humor": 9, "enthusiasm": 10, "empathy": 7, "storytelling": 9}

# label, tone sliders, keep the brand document?
TONE_CONDITIONS = [
    ("A. No document, casual sliders (formality 3, humor 7, enthusiasm 8)", CASUAL, False),
    ("B. No document, formal sliders (formality 9, humor 1, enthusiasm 2) [control]", FORMAL, False),
    ("C. With document, extreme casual sliders (formality 1, humor 9, enthusiasm 10)", EXTREME, True),
]


def tone_features(text: str) -> dict:
    words = re.findall(r"[\w'’-]+", text)
    n = max(len(words), 1)
    sents = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
    return {
        "words": len(words),
        "words_per_sentence": round(len(words) / max(len(sents), 1), 1),
        "contractions": len(re.findall(r"\w(?:n['’]t|['’](?:re|ve|ll|d|m))\b", text)),
        "you_your": len(re.findall(r"\b(?:you|your|you're)\b", text, re.I)),
        "exclamations": text.count("!"),
        "questions": text.count("?"),
        "em_dashes": text.count("—"),
    }


def cmd_toneprobe(a) -> None:
    """Re-run the brand optimizer on one approved draft under different tone/document settings."""
    from agents import brand_optimizer
    st = load_state(a.run)
    base = st["steps"][str(a.source)]["output"]
    profile = build_profile(st)
    install_recorder()
    CURRENT["step"] = "tone-probe"
    results = []

    async def _optimise_all() -> list:
        out = []
        for label, tone, keep_doc in TONE_CONDITIONS:
            prof = dict(profile, tone_settings=dict(tone), tone=dict(tone))
            if not keep_doc:
                prof.update(document_context="", doc_context="", has_documents=False, document_count=0)
            start = len(CALLS)
            r = await brand_optimizer.run(content=base, brand_profile=prof, platform=st["cfg"]["platform"])
            out.append((label, r, CALLS[start]))
        return out

    for label, r, call in asyncio.run(_optimise_all()):
        results.append({
            "label": label, "output": r["content"], "changed": r["content"] != base,
            "similarity": round(difflib.SequenceMatcher(None, base, r["content"]).ratio(), 2),
            "features": tone_features(r["content"]), "provider": call["provider"], "tokens": call["tokens"],
            "doc_in_prompt": "BRAND DOCUMENT" in call["user"].upper() or "uploaded by the user" in call["user"],
            "banned_hits": [b for b in profile["banned_phrases"] if b.lower() in r["content"].lower()],
        })
    st["tone_probe"] = {"source_step": a.source, "base": base, "base_features": tone_features(base), "results": results}
    save_state(a.run, st)

    rows = [("Step 2 draft (input)", st["tone_probe"]["base_features"], "-", "-")] + \
           [(r["label"], r["features"], "yes" if r["changed"] else "NO", r["similarity"]) for r in results]
    table = ("| Condition | Words | Words / sentence | Contractions | you / your | ! | ? | Dashes | Changed? | Similarity to input |\n"
             "|---|---|---|---|---|---|---|---|---|---|\n" +
             "\n".join(f"| {l} | {f['words']} | {f['words_per_sentence']} | {f['contractions']} | {f['you_your']} | "
                       f"{f['exclamations']} | {f['questions']} | {f['em_dashes']} | {c} | {s} |" for l, f, c, s in rows))
    body = "\n\n".join(f"**{r['label']}** (served by {r['provider']}, {r['tokens']} tokens)\n\n" +
                       "\n".join("> " + l for l in r["output"].splitlines()) for r in results)
    append_report(a.run, f"## Tone confirm test (after step {a.source})\n\nSame input draft, brand optimizer only.\n\n{table}\n\n{body}")

    print(table, "\n")
    for r in results:
        print(f"##### {r['label']} | changed={r['changed']} sim={r['similarity']} | {r['provider']}")
        print(r["output"], "\n")


PIECE_TONES = [
    ("Baseline (no spectrum)", {}),
    ("Playful 9, excited 7", {"playful": 9, "excited": 7}),
    ("Serious 9, confident 8", {"serious": 9, "confident": 8}),
    ("Empathetic 9, curious 7", {"empathetic": 9, "curious": 7}),
]


def cmd_piecetone(a) -> None:
    """Step 1 (canonical writer, real wiring) once per per-piece tonality spectrum."""
    st = load_state(a.run)
    doc = paths(a.run)["doc"].read_text(encoding="utf-8")
    install_recorder()
    CURRENT["step"] = "piece-tone"

    async def go() -> list:
        out = []
        for label, spec in PIECE_TONES:
            s2 = json.loads(json.dumps(st))
            s2["cfg"]["tonality_spectrum"] = spec
            start = len(CALLS)
            res = await run_step(s2, 1, "")
            out.append((label, spec, res, CALLS[start:]))
        return out

    results = []
    for label, spec, res, calls in asyncio.run(go()):
        text, profile = res["output"], res["profile"]
        inj = injection_report(calls, doc, profile, spec)
        results.append({"label": label, "spec": spec, "output": text, "features": tone_features(text),
                        "tells": metrics(text, doc, profile)["tells_effective"],
                        "spectrum_in_prompt": [r["piece_tonality"] for r in inj],
                        "provider": sorted({c["provider"] for c in calls}),
                        "tokens": sum(c["tokens"] for c in calls)})
    st["piece_tone"] = results
    save_state(a.run, st)

    table = ("| Per-piece tone | Spectrum in prompt | Words | Words / sentence | Contractions | you / your | ! | ? | Dashes | Tells |\n"
             "|---|---|---|---|---|---|---|---|---|---|\n" +
             "\n".join(f"| {r['label']} | {r['spectrum_in_prompt'] if r['spec'] else 'n/a'} | {r['features']['words']} | "
                       f"{r['features']['words_per_sentence']} | {r['features']['contractions']} | {r['features']['you_your']} | "
                       f"{r['features']['exclamations']} | {r['features']['questions']} | {r['features']['em_dashes']} | {r['tells']} |"
                       for r in results))
    body = "\n\n".join(f"**{r['label']}** (served by {', '.join(r['provider'])}, {r['tokens']} tokens)\n\n" +
                       "\n".join("> " + l for l in r["output"].splitlines()) for r in results)
    append_report(a.run, f"## Per-piece tone test (canonical writer)\n\n{table}\n\n{body}")
    print(table, "\n")
    for r in results:
        print(f"##### {r['label']} | {r['provider']} | {r['tokens']} tokens")
        print(r["output"], "\n")


SEEDED_PREFIX = (
    "In today's fast-paced digital landscape, Zomato isn't just a food app, it's a game-changing platform "
    "that will disrupt how India eats. In 2019, Zomato served 3.2 billion orders across 47 countries. "
    "As a founder who spent 12 years building delivery fleets, I personally trained every one of our "
    "delivery boys. Our unbeatable network speaks for itself.\n\n")
SEEDED_SUFFIX = "Eternal Limited is the best investment in Indian food-tech, and investors should buy the stock now.\n\n"
# (label, text to look for, case-insensitive)
SEEDED_PROBES = [
    ("Banned phrase: game-changing", "game-changing"), ("Banned phrase: disrupt", "disrupt"),
    ("Banned phrase: delivery boys", "delivery boys"), ("Banned phrase: unbeatable", "unbeatable"),
    ("Invented stat: 3.2 billion orders", "3.2 billion"), ("Invented stat: 47 countries", "47 countries"),
    ("Invented founder claim: 12 years", "12 years"), ("Invented founder claim: personally trained", "personally trained"),
    ("AI opening: In today's", "in today's"), ("Negation contrast: isn't just", "isn't just"),
    ("Investment advice: buy the stock", "buy the stock"), ("Investment advice: best investment", "best investment"),
]
SERIOUS_PROBES = [("Ungrounded: directory revenue depends on advertising", "depends on advertising"),
                  ("Ungrounded: advertising and visibility", "advertising and visibility")]


def cmd_rulestress(a) -> None:
    """Run the rule engine on drafts with known defects and report which survive."""
    from agents.rule_engine import RuleEngineOrchestrator
    st = load_state(a.run)
    doc = paths(a.run)["doc"].read_text(encoding="utf-8")
    profile = build_profile(st)
    c = st["cfg"]
    clean = st["steps"]["4"]["output"]
    body, _, tags = clean.rpartition("\n\n")
    seeded = SEEDED_PREFIX + body + "\n\n" + SEEDED_SUFFIX + tags
    serious = next(r for r in st["piece_tone"] if r["label"].startswith("Serious"))["output"]
    cases = [("Seeded-defect draft (synthetic)", seeded, "linkedin_post", SEEDED_PROBES),
             ("Natural draft: Serious 9 / confident 8 from the tone test", serious, "blog_post", SERIOUS_PROBES)]
    install_recorder()
    CURRENT["step"] = "rule-stress"

    async def go() -> list:
        out = []
        for label, text, platform, probes in cases:
            start = len(CALLS)
            res = await RuleEngineOrchestrator().process(
                content=text, user_prompt=c["topic"], brand_data=profile,
                extra_context={"platform": platform, "objective": c["objective"], "content_type": "article",
                               "keywords": [], "cta": c["cta"]})
            out.append((label, text, platform, probes, res, CALLS[start:]))
        return out

    results = []
    for label, text, platform, probes, res, calls in asyncio.run(go()):
        final = res.final_content
        v = res.static_validation
        results.append({
            "label": label, "platform": platform, "input": text, "output": final,
            "score": res.final_score, "passed": v.passed, "iterations": res.total_iterations,
            "log": [{k: i[k] for k in ("iteration", "score", "static_score", "dynamic_score", "passed",
                                       "total_violations", "critical_failures")} for i in res.improvement_log],
            "violations": [{"id": x.rule_id, "name": x.rule_name, "severity": x.severity.value,
                            "location": (x.location or "")[:100]} for x in v.violations],
            "probes": [{"label": l, "before": t_.lower() in text.lower(), "after": t_.lower() in final.lower()}
                       for l, t_ in probes],
            "metrics_before": metrics(text, doc, profile), "metrics_after": metrics(final, doc, profile),
            "tokens": sum(x["tokens"] for x in calls), "calls": len(calls),
            "providers": sorted({x["provider"] for x in calls}), "secs": round(sum(x["secs"] for x in calls), 1),
        })
    st["rule_stress"] = results
    save_state(a.run, st)

    md = ["## Rule engine stress test (after step 5)"]
    for r in results:
        mb, ma = r["metrics_before"], r["metrics_after"]
        md.append(f"### {r['label']}\n\nPlatform setting {r['platform']} · score {r['score']} · passed {r['passed']} · "
                  f"iterations {r['iterations']} · {r['calls']} LLM calls · {r['tokens']} tokens\n\n"
                  "| Iteration | Score | Static | Dynamic | Passed | Violations |\n|---|---|---|---|---|---|\n" +
                  "\n".join(f"| {i['iteration']} | {i['score']:.1f} | {i['static_score']:.1f} | {i['dynamic_score']:.1f} | "
                            f"{i['passed']} | {i['total_violations']} |" for i in r["log"]) +
                  "\n\n| Planted / suspect item | In input | In output |\n|---|---|---|\n" +
                  "\n".join(f"| {p['label']} | {'yes' if p['before'] else 'no'} | {'STILL THERE' if p['after'] else 'removed'} |"
                            for p in r["probes"]) +
                  f"\n\nTells {mb['tells_effective']} to {ma['tells_effective']} · words {mb['words']} to {ma['words']} · "
                  f"banned hits {mb['banned_hits']} to {ma['banned_hits']} · numbers not in brand document "
                  f"{mb['numbers_not_in_brand_doc']} to {ma['numbers_not_in_brand_doc']}\n\n"
                  "**Violations open at the end:** " +
                  ("; ".join(f"{x['id']} {x['name']} ({x['severity']})" for x in r["violations"]) or "none") +
                  "\n\n**Input**\n\n" + "\n".join("> " + l for l in r["input"].splitlines()) +
                  "\n\n**Output**\n\n" + "\n".join("> " + l for l in r["output"].splitlines()))
    append_report(a.run, "\n\n".join(md))

    for r in results:
        print(f"\n######## {r['label']} | score {r['score']} passed {r['passed']} iters {r['iterations']} | "
              f"{r['calls']} calls {r['tokens']} tokens {r['secs']}s | {r['providers']}")
        for i in r["log"]:
            print(f"  iter {i['iteration']}: score {i['score']:.1f} (static {i['static_score']:.1f}, dynamic {i['dynamic_score']:.1f}) "
                  f"violations {i['total_violations']} critical {i['critical_failures']}")
        for p in r["probes"]:
            print(f"  [{'STILL THERE' if p['after'] else 'removed':11}] in_input={p['before']} :: {p['label']}")
        print("  open violations:", [(x["id"], x["name"]) for x in r["violations"]])
        print("  metrics before:", {k: r["metrics_before"][k] for k in ("words", "tells_effective", "banned_hits", "numbers_not_in_brand_doc")})
        print("  metrics after: ", {k: r["metrics_after"][k] for k in ("words", "tells_effective", "banned_hits", "numbers_not_in_brand_doc")})
        print("\n--- OUTPUT ---\n" + r["output"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init"); i.add_argument("--run", required=True); i.add_argument("--pdf", required=True)
    i.add_argument("--cfg", help="JSON file overriding DEFAULT_CFG keys")
    r = sub.add_parser("run"); r.add_argument("--run", required=True); r.add_argument("step", type=int)
    r.add_argument("--feedback", default="")
    v = sub.add_parser("verdict"); v.add_argument("--run", required=True); v.add_argument("step", type=int)
    v.add_argument("decision", choices=["approve", "revise"]); v.add_argument("note", nargs="?", default="")
    t = sub.add_parser("tone-probe"); t.add_argument("--run", required=True)
    t.add_argument("--source", type=int, default=2, help="step whose output is the input draft")
    p = sub.add_parser("piece-tone"); p.add_argument("--run", required=True)
    rs = sub.add_parser("rule-stress"); rs.add_argument("--run", required=True)
    a = ap.parse_args()
    {"init": cmd_init, "run": cmd_run, "verdict": cmd_verdict, "tone-probe": cmd_toneprobe,
     "piece-tone": cmd_piecetone, "rule-stress": cmd_rulestress}[a.cmd](a)


if __name__ == "__main__":
    main()
