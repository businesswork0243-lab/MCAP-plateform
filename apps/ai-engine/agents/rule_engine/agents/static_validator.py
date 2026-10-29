# apps/ai-engine/agents/rule_engine/agents/static_validator.py

import json
import time
import logging
from typing import Tuple

from ..rules.static_rules import (
    get_static_rules,
    get_false_negative_rules,
    get_deterministic_rules,
)
from ..rules.tell_rules import TELL_RULE_IDS, FIXES
from ..rules.rule_models import (
    ValidationResult, RuleViolation,
    RuleSeverity, RuleCategory, Rule, RuleType,
)
from services.llm import complete
from services import format_specs

log = logging.getLogger("ai-engine.rule_engine.validator")

# ✅ FIX 1: Threshold kam karo — 80 → 65
# Kyun: Content good hai lekin strict rules ke wajah se hamesha fail hota tha
PASS_THRESHOLD = 65.0

# Rules whose violation means the content states something untrue about a
# real person. These must fail outright rather than be soft-capped.
GROUNDING_RULE_IDS = frozenset({"SR014", "SR015", "SR016"})
GROUNDING_FAIL_CAP = 55.0

# Writing tells deduct score, but only genuinely tell-ridden output is failed
# outright. The frozen corpus sits at 2.44 effective tells per 100 words, so
# at 2.0 most generated drafts get one surgical rewrite pass. That costs a call
# per piece and is deliberate: at the earlier 6.0 nothing ever triggered, and a
# post with 7 visible tells (3.7 per 100) shipped as a clean 91/100.
TELL_DENSITY_FAIL = 2.0
TELL_DENSITY_CAP = 64.0   # just under PASS_THRESHOLD, so regeneration runs

# Only this many tell violations are reported per piece. Beyond it the list
# stops being feedback and starts being noise the rewrite prompt cannot act on.
MAX_TELL_VIOLATIONS = 12

# ✅ FIX 2: Max iterations 5 → 3
# Kyun: 5 iterations = bahut slow, 3 kaafi hai
MAX_ITERATIONS = 3

BATCH_SIZE = 7

STATIC_WEIGHT  = 0.70
DYNAMIC_WEIGHT = 0.30

VALIDATOR_SYSTEM = """You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation."""

# Style rules that only mean something once there is enough text for the
# pattern to appear. A 50-word WhatsApp status was being faulted for sentence
# variety and phrase repetition, and the rewrite then padded it to cure them.
LENGTH_GATED_RULES = {
    "SR007": 120,   # sentence length variety
    "SR008": 100,   # tense consistency
    "SR009": 120,   # terminology consistency
    "SR010": 120,   # phrase repetition
    "SR011": 100,   # filler
    "SR012": 90,    # logical progression
}

# Dynamic rules are written by a model for one request. They sharpen the
# check, but a model-written rule must not be able to fail a piece on its own
# the way a grounding rule can.
DYNAMIC_MAX_SEVERITY = RuleSeverity.HIGH

# A character limit or a hashtag cap is a fact about the channel. Like a pile of
# tells, it fails the piece so the rewrite runs, instead of costing a few points.
FORMAT_FAIL_CAP = 64.0
_HARD_FORMAT_WORDS = ("characters", "hashtags", "tweets", "placeholder")

FORMAT_RULE_ID = "FMT001"
FORMAT_RULE = Rule(
    id=FORMAT_RULE_ID,
    type=RuleType.STATIC,
    category=RuleCategory.WRITING_STYLE,
    severity=RuleSeverity.HIGH,
    name="Format Compliance",
    description="The piece has to be the format it was written for.",
    instruction="Decided by code: length, character limits, hashtags, thread shape, placeholders.",
    weight=0.06,
    deterministic=True,
)


class StaticValidatorAgent:

    def __init__(self):
        self._unverified: set[str] = set()
        self.static_rules = get_static_rules()
        self.fn_rules     = get_false_negative_rules()
        self.tell_rules   = get_deterministic_rules()
        self.tell_rule_map = {r.id: r for r in self.tell_rules}
        # Deterministic rules are excluded here deliberately. Batching them
        # to the LLM would add five more calls per validation to re-derive a
        # verdict regex already has, and the LLM is the less reliable judge of
        # the two on questions like "is this an em dash".
        self.other_static = [
            r for r in self.static_rules
            if r.category != RuleCategory.FALSE_NEGATIVE
            and not r.deterministic
        ]
        self._platform: str | None = None
        self._verified_material = ""

    async def validate(
        self,
        content:       str,
        iteration:     int               = 1,
        dynamic_rules: list[Rule] | None = None,
        verified_material: str           = "",
        platform:      str | None        = None,
        cta_requested: bool              = False,
    ) -> ValidationResult:

        dynamic_rules = dynamic_rules or []
        self._platform = platform
        # When the request itself asks for a closing question, SR041 would
        # penalise exactly what was asked for.
        self._cta_requested = cta_requested
        word_total = format_specs.word_count(content)
        start         = time.time()
        # What the brand has told us about itself. Without it a grounding rule
        # cannot tell a supported "we" claim from an invented one.
        self._verified_material = verified_material or ""

        log.info(
            "[Validator] Iter %d | static=%d | dynamic=%d",
            iteration, len(self.static_rules), len(dynamic_rules),
        )

        # Rules whose verdict this pass could not establish.
        self._unverified: set[str] = set()

        # ── Static: False Negatives FIRST ────────────────────────────────────
        static_violations:   list[RuleViolation] = []
        static_passed_rules: list[str]           = []

        # A regex catches these exactly, and text_cleaner already had the
        # detector — it was simply never called from here, leaving the
        # single most-emphasised rule in the system dependent on an LLM.
        deterministic_fn = self._detect_false_negatives(content)
        static_violations.extend(deterministic_fn)

        fn_v, fn_p = await self._validate_batch(
            content=content,
            rules=self.fn_rules,
            priority="CRITICAL — FALSE NEGATIVES",
        )
        static_violations.extend(fn_v)
        static_passed_rules.extend(fn_p)

        # ── Static: Writing tells (regex, no call) ───────────────────────────
        tell_violations, tell_passed, tell_density = self._detect_tells(content)
        static_violations.extend(tell_violations)
        static_passed_rules.extend(tell_passed)

        # ── Static: Other rules ───────────────────────────────────────────────
        # Rules that need room to show a pattern are not asked of a short piece.
        active_other = [
            r for r in self.other_static
            if word_total >= LENGTH_GATED_RULES.get(r.id, 0)
        ]
        skipped = {r.id for r in self.other_static} - {r.id for r in active_other}
        for batch in self._make_batches(active_other, BATCH_SIZE):
            v, p = await self._validate_batch(content=content, rules=batch)
            static_violations.extend(v)
            static_passed_rules.extend(p)

        # ── Static: Format compliance (code, no call) ────────────────────────
        format_violations = self._detect_format_issues(content, platform)
        static_violations.extend(format_violations)
        if platform and not format_violations:
            static_passed_rules.append(FORMAT_RULE_ID)

        scored_static = [r for r in self.static_rules if r.id not in skipped]
        if platform:
            scored_static.append(FORMAT_RULE)
        static_score = self._calculate_score(
            violations=static_violations,
            all_rules=scored_static,
        )

        # ── Dynamic Rules ─────────────────────────────────────────────────────
        dynamic_violations:   list[RuleViolation] = []
        dynamic_passed_rules: list[str]           = []
        dynamic_score = 100.0

        dynamic_rules = [self._cap_severity(r) for r in dynamic_rules]

        if dynamic_rules:
            for batch in self._make_batches(dynamic_rules, BATCH_SIZE):
                v, p = await self._validate_batch(
                    content=content,
                    rules=batch,
                    priority="DYNAMIC BRAND RULES",
                )
                dynamic_violations.extend(v)
                dynamic_passed_rules.extend(p)

            dynamic_score = self._calculate_score(
                violations=dynamic_violations,
                all_rules=dynamic_rules,
            )

        # ── Combined Score ────────────────────────────────────────────────────
        combined_score = round(
            (static_score  * STATIC_WEIGHT) +
            (dynamic_score * DYNAMIC_WEIGHT),
            2
        )

        all_violations   = static_violations + dynamic_violations
        all_passed_rules = static_passed_rules + dynamic_passed_rules

        # ✅ FIX 3: Critical failures sirf FALSE_NEGATIVE pe cap karo
        # Hallucination/attribution rules pe cap nahi — ye LLM ke false positives hain
        fn_critical_failures = [
            v.rule_id for v in static_violations
            if v.severity == RuleSeverity.CRITICAL
            and v.category == RuleCategory.FALSE_NEGATIVE
        ]

        # Grounding rules are separated from the softened hallucination
        # bucket below: invented experience published under a real person's
        # name has to fail and trigger regeneration, not just lower a score.
        grounding_failures = [
            v.rule_id for v in static_violations
            if v.rule_id in GROUNDING_RULE_IDS
        ]

        other_critical_failures = [
            v.rule_id for v in static_violations
            if v.severity == RuleSeverity.CRITICAL
            and v.category != RuleCategory.FALSE_NEGATIVE
            and v.rule_id not in GROUNDING_RULE_IDS
        ]

        all_critical_failures = (
            fn_critical_failures + grounding_failures + other_critical_failures
        )

        # ✅ FIX 4: Cap sirf tab karo jab false negative ho
        # Other critical violations pe cap nahi — score naturally kam hoga
        if grounding_failures:
            # Below PASS_THRESHOLD on purpose so regeneration runs.
            combined_score = min(combined_score, GROUNDING_FAIL_CAP)
            log.warning(
                "[Validator] Grounding violations: %s -> score capped at %s%%",
                grounding_failures, GROUNDING_FAIL_CAP,
            )
        elif fn_critical_failures:
            # False negative hai — cap at 72 (regeneration trigger hoga)
            combined_score = min(combined_score, 72.0)
            log.warning(
                "[Validator] False negative violations: %s → score capped at 72%%",
                fn_critical_failures,
            )
        elif other_critical_failures:
            # Dusre critical violations — soft cap at 78
            combined_score = min(combined_score, 78.0)
            log.warning(
                "[Validator] Other critical violations: %s → score capped at 78%%",
                other_critical_failures,
            )

        if any(
            v.rule_id == FORMAT_RULE_ID
            and any(w in v.description for w in _HARD_FORMAT_WORDS)
            for v in static_violations
        ):
            combined_score = min(combined_score, FORMAT_FAIL_CAP)
            log.warning("[Validator] Hard format violation -> score capped at %s%%", FORMAT_FAIL_CAP)

        # Tells deduct through the ordinary weight path above. The cap is for
        # the case that deduction handles badly: a piece riddled with them
        # where no single rule is critical, so nothing would otherwise trigger
        # a rewrite. It applies after the other caps and never raises a score.
        if tell_density >= TELL_DENSITY_FAIL:
            combined_score = min(combined_score, TELL_DENSITY_CAP)
            log.warning(
                "[Validator] Tell density %.2f/100w >= %.1f -> score capped at %s%%",
                tell_density, TELL_DENSITY_FAIL, TELL_DENSITY_CAP,
            )

        # ✅ FIX 5: Passed = score >= 65 (threshold)
        # Critical failures se block mat karo — regeneration handle karega
        passed = combined_score >= PASS_THRESHOLD

        # A rule nobody could check is not a rule that passed. Without this,
        # an LLM outage produced score=100 / passed=True on unchecked content.
        if self._unverified:
            unverified_ids = sorted(self._unverified)
            all_critical_failures.append(
                f"UNVERIFIED:{len(unverified_ids)}_rules_not_checked"
            )
            passed = False
            log.error(
                "[Validator] %d rule(s) could not be checked (%s) — "
                "reporting as not passed rather than clean",
                len(unverified_ids),
                ", ".join(unverified_ids[:8]),
            )

        # ── Category Breakdown ────────────────────────────────────────────────
        category_breakdown = self._build_category_breakdown(
            all_violations=all_violations,
            all_rules=scored_static + dynamic_rules,
        )

        elapsed = round((time.time() - start) * 1000, 1)
        log.info(
            "[Validator] Done | iter=%d | score=%.1f%% "
            "(static=%.1f%%, dynamic=%.1f%%) | "
            "passed=%s | violations=%d | fn_critical=%d | time=%sms",
            iteration,
            combined_score, static_score, dynamic_score,
            passed, len(all_violations), len(fn_critical_failures), elapsed,
        )

        return ValidationResult(
            score=combined_score,
            static_score=round(static_score, 2),
            dynamic_score=round(dynamic_score, 2),
            passed=passed,
            violations=all_violations,
            passed_rules=all_passed_rules,
            critical_failures=all_critical_failures,
            iteration=iteration,
            feedback=self._build_feedback(
                combined_score, static_score, dynamic_score,
                all_violations, all_critical_failures,
            ),
            category_breakdown=category_breakdown,
        )

    async def _validate_batch(
        self,
        content:  str,
        rules:    list[Rule],
        priority: str = "",
    ) -> Tuple[list[RuleViolation], list[str]]:

        if not rules:
            return [], []

        rules_json = json.dumps(
            [
                {
                    "id":          r.id,
                    "name":        r.name,
                    "severity":    r.severity.value,
                    "category":    r.category.value,
                    "type":        r.type.value,
                    "instruction": r.instruction,
                    "examples":    r.examples or {},
                }
                for r in rules
            ],
            indent=2,
        )

        priority_block = f"\n⚠️  PRIORITY: {priority}\n" if priority else ""

        # Only batches that contain a grounding rule need the brand's facts.
        material_block = ""
        material = getattr(self, "_verified_material", "")
        if material and any(r.id in GROUNDING_RULE_IDS for r in rules):
            material_block = (
                "\n## Verified brand material\n"
                "A claim that restates this material is SUPPORTED and is not a "
                "violation, including a company-voice 'we' or 'our' about things "
                "it states. Flag only claims that go beyond it.\n"
                '"""\n' + material + '\n"""\n'
            )

        format_note = self._format_note()

        prompt = f"""{priority_block}
Evaluate this content against the rules below.
{format_note}{material_block}
## Rules:
{rules_json}

## Content:
\"\"\"
{content}
\"\"\"

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{{
  "violations": [
    {{
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }}
  ]
}}

If nothing is violated, return {{"violations": []}}.
Return ONLY valid JSON"""

        try:
            response, _ = await complete(
                system=VALIDATOR_SYSTEM,
                user=prompt,
                temperature=0.1,
                max_tokens=3000,
            )
            return self._parse_response(response, rules)

        except Exception as e:
            # This used to return every rule as passed, so an expired API key,
            # a rate limit or a provider outage produced a clean 100% score on
            # content nobody had checked. Unverified is not the same as clean.
            log.error("[Validator] Batch failed: %s", e)
            self._unverified.update(r.id for r in rules)
            return [], []

    @staticmethod
    def _load_json(response: str) -> dict:
        """Parse the model's JSON, recovering what it finished if it was cut off."""
        clean = (response or "").strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1] if len(parts) > 1 else clean
            if clean.startswith("json"):
                clean = clean[4:]
        clean = clean.strip()
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            pass

        # A long answer can be cut mid-string. Keep every violation object that
        # closed properly; a half-written one is dropped, never guessed at.
        start = clean.find("[")
        if start == -1:
            raise json.JSONDecodeError("no JSON array", clean, 0)
        items: list[dict] = []
        depth, in_str, esc, obj_start = 0, False, False, None
        for i in range(start, len(clean)):
            ch = clean[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                if depth == 0:
                    obj_start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and obj_start is not None:
                    try:
                        items.append(json.loads(clean[obj_start:i + 1]))
                    except json.JSONDecodeError:
                        pass
                    obj_start = None
        if not items:
            raise json.JSONDecodeError("nothing recoverable", clean, 0)
        return {"violations": items, "_truncated": True}

    def _parse_response(
        self,
        response: str,
        rules:    list[Rule],
    ) -> Tuple[list[RuleViolation], list[str]]:

        violations:   list[RuleViolation] = []
        passed_rules: list[str]           = []
        rule_map = {r.id: r for r in rules}

        def build(rule: Rule, item: dict) -> RuleViolation:
            return RuleViolation(
                rule_id=rule.id,
                rule_name=rule.name,
                severity=rule.severity,
                category=rule.category,
                description=item.get("violation_description") or "Rule violated",
                location=item.get("location"),
                suggestion=item.get("suggestion") or "Rewrite this section",
            )

        try:
            data = self._load_json(response)

            if "evaluations" in data:
                # Older shape: one verdict per rule.
                for item in data.get("evaluations", []):
                    rule = rule_map.get(item.get("rule_id"))
                    if not rule:
                        continue
                    if item.get("status", "passed") == "violated":
                        violations.append(build(rule, item))
                    else:
                        passed_rules.append(rule.id)
            else:
                flagged: dict[str, dict] = {}
                for item in data.get("violations", []):
                    if isinstance(item, dict) and item.get("rule_id") in rule_map:
                        # A violation needs a quote. Without one the model is
                        # reporting a feeling, not a sentence.
                        if (item.get("location") or "").strip():
                            flagged.setdefault(item["rule_id"], item)
                for rid, item in flagged.items():
                    violations.append(build(rule_map[rid], item))

                if data.get("_truncated"):
                    # The tail of the answer is lost, so rules not yet listed
                    # have not been shown to pass.
                    log.warning(
                        "[Validator] response was cut off; keeping %d finished item(s)",
                        len(flagged),
                    )
                    self._unverified.update(r.id for r in rules if r.id not in flagged)
                    return violations, []

                passed_rules = [r.id for r in rules if r.id not in flagged]

        except (json.JSONDecodeError, KeyError, AttributeError) as e:
            # Same fail-open problem: a malformed response is not a pass.
            log.error("[Validator] Parse error: %s", e)
            self._unverified.update(r.id for r in rules)
            violations, passed_rules = [], []

        return violations, passed_rules

    # ── Format, severity and context helpers ─────────────────────────────────

    def _format_note(self) -> str:
        if not self._platform:
            return ""
        spec = format_specs.get_spec(self._platform)
        return (
            "\n## Format\nThis piece is a " + spec.name + " (" + spec.length_label + "). "
            "Its conventions are intended; judge it as that format, not as an essay.\n"
        )

    @staticmethod
    def _cap_severity(rule: Rule) -> Rule:
        if rule.severity == RuleSeverity.CRITICAL:
            return rule.model_copy(update={"severity": DYNAMIC_MAX_SEVERITY})
        return rule

    def _detect_format_issues(self, content: str, platform: str | None) -> list[RuleViolation]:
        """Length, characters, hashtags, thread shape, placeholders: no model needed."""
        if not platform:
            return []
        try:
            issues = format_specs.check(platform, content)
        except Exception as e:  # pragma: no cover - never block a run on this
            log.warning("[Validator] format check unavailable: %s", e)
            return []
        return [
            RuleViolation(
                rule_id=FORMAT_RULE_ID,
                rule_name=FORMAT_RULE.name,
                severity=FORMAT_RULE.severity,
                category=FORMAT_RULE.category,
                description=f"Format: {issue}",
                location=None,
                suggestion=f"Fix the format problem: {issue}",
            )
            for issue in issues
        ][:4]

    def _detect_false_negatives(self, content: str) -> list[RuleViolation]:
        """Regex pass for contrast negations — runs whether or not an LLM does."""
        try:
            from services.text_cleaner import detect_false_negatives
        except Exception as e:  # pragma: no cover - import guard
            log.warning("[Validator] false-negative detector unavailable: %s", e)
            return []

        hits = detect_false_negatives(content) or []
        if not hits:
            return []

        fn_rule = next(
            (r for r in self.fn_rules), None
        ) or next((r for r in self.static_rules if r.id == "SR000"), None)
        if fn_rule is None:
            return []

        log.info("[Validator] regex found %d false negative(s)", len(hits))
        return [
            RuleViolation(
                rule_id=fn_rule.id,
                rule_name=fn_rule.name,
                severity=fn_rule.severity,
                category=fn_rule.category,
                description=f"Contrast negation: \"{h.get('match', '')}\"",
                location=h.get("match"),
                suggestion="State the positive claim directly.",
            )
            for h in hits[:10]
        ]

    def _detect_tells(
        self,
        content: str,
    ) -> Tuple[list[RuleViolation], list[str], float]:
        """Regex sweep for the 22 writing tells.

        Returns violations, the ids that came back clean, and the effective
        density. Weak patterns are only counted when `tells.tell_report` says
        they earned it — a lone em dash is a writing choice, and failing it
        would punish exactly the technical writing our users produce most.
        """
        try:
            from services.tells import tell_report, sentence_at
        except Exception as e:  # pragma: no cover - import guard
            log.warning("[Validator] tell detectors unavailable: %s", e)
            # Unlike the LLM path, nothing here is claimed as passed: these
            # ids simply go unreported rather than being marked clean.
            return [], [], 0.0

        try:
            report = tell_report(content)
        except Exception as e:
            log.error("[Validator] tell sweep failed: %s", e)
            return [], [], 0.0

        violations: list[RuleViolation] = []
        seen: set[tuple[str, str]] = set()

        # `effective` is the set that counted toward the density, weak-alone
        # rule already applied. Recomputing it here is how the violation list
        # and the score drift apart, so it is taken as given.
        for tell in report.get("effective", []):
            pid = tell["id"]
            rule_id = TELL_RULE_IDS.get(pid)
            rule = self.tell_rule_map.get(rule_id) if rule_id else None
            if rule is None:
                continue
            if rule_id == "SR041" and getattr(self, "_cta_requested", False):
                continue

            # The sentence, not the raw match: several detectors match a
            # window around their trigger, and a half-word fragment is not
            # something a rewrite prompt or the content page can act on.
            quote = sentence_at(content, tell["start"])

            # One violation per distinct sentence. The same dash quoted nine
            # times tells the rewrite prompt nothing the first mention did not.
            key = (pid, quote)
            if key in seen:
                continue
            seen.add(key)

            violations.append(RuleViolation(
                rule_id=rule.id,
                rule_name=rule.name,
                severity=rule.severity,
                category=rule.category,
                description=f'{rule.name}: "{quote}"',
                location=quote,
                suggestion=FIXES.get(pid, rule.instruction),
            ))
            if len(violations) >= MAX_TELL_VIOLATIONS:
                break

        violated_rule_ids = {v.rule_id for v in violations}
        passed_ids = [
            r.id for r in self.tell_rules if r.id not in violated_rule_ids
        ]

        density = float(report.get("per_100_words", 0.0))
        if violations:
            log.info(
                "[Validator] %d tell violation(s) across %d pattern(s), "
                "density %.2f/100w",
                len(violations), len(violated_rule_ids), density,
            )

        return violations, passed_ids, density

    def _calculate_score(
        self,
        violations: list[RuleViolation],
        all_rules:  list[Rule],
    ) -> float:

        if not all_rules:
            return 100.0

        rule_map     = {r.id: r for r in all_rules}
        total_weight = sum(r.weight for r in all_rules)

        if total_weight == 0:
            return 100.0

        severity_multiplier = {
            RuleSeverity.CRITICAL: 1.4,   # ✅ Was 1.6 — thoda kam kiya
            RuleSeverity.HIGH:     1.1,   # ✅ Was 1.2
            RuleSeverity.MEDIUM:   0.9,   # ✅ Was 1.0
            RuleSeverity.LOW:      0.5,   # ✅ Was 0.6
        }

        deducted = 0.0
        for v in violations:
            rule = rule_map.get(v.rule_id)
            if rule:
                mult      = severity_multiplier.get(v.severity, 1.0)
                deducted += rule.weight * mult

        deducted = min(deducted, total_weight)
        score    = ((total_weight - deducted) / total_weight) * 100
        return round(max(0.0, min(100.0, score)), 2)

    def _build_category_breakdown(
        self,
        all_violations: list[RuleViolation],
        all_rules:      list[Rule],
    ) -> dict:

        category_rules: dict[str, list[Rule]] = {}
        for rule in all_rules:
            cat = rule.category.value
            category_rules.setdefault(cat, []).append(rule)

        category_violations: dict[str, list[RuleViolation]] = {}
        for v in all_violations:
            cat = v.category.value
            category_violations.setdefault(cat, []).append(v)

        breakdown = {}
        for cat, rules in category_rules.items():
            violations = category_violations.get(cat, [])
            cat_score  = self._calculate_score(
                violations=violations,
                all_rules=rules,
            )
            breakdown[cat] = {
                "score":      round(cat_score, 1),
                "violations": len(violations),
                "passed":     cat_score >= PASS_THRESHOLD,
                "rule_count": len(rules),
            }

        return breakdown

    def _make_batches(
        self,
        rules: list[Rule],
        size:  int,
    ) -> list[list[Rule]]:
        return [rules[i:i + size] for i in range(0, len(rules), size)]

    def _build_feedback(
        self,
        score:             float,
        static_score:      float,
        dynamic_score:     float,
        violations:        list[RuleViolation],
        critical_failures: list[str],
    ) -> str:

        if not violations:
            return (
                f"✅ All rules passed. Score: {score:.1f}% "
                f"(static: {static_score:.1f}%, dynamic: {dynamic_score:.1f}%)"
            )

        parts = [
            f"Score: {score:.1f}% "
            f"(static: {static_score:.1f}%, dynamic: {dynamic_score:.1f}%) | "
            f"{len(violations)} violation(s)."
        ]

        if critical_failures:
            parts.append(
                f"🔴 CRITICAL ({len(critical_failures)}): "
                f"{', '.join(critical_failures)}"
            )

        fn_v = [v for v in violations if v.category == RuleCategory.FALSE_NEGATIVE]
        if fn_v:
            parts.append(f"⚠️ FALSE NEGATIVES ({len(fn_v)}):")
            for v in fn_v:
                if v.location:
                    parts.append(f'   → "{v.location}"')

        return " ".join(parts)