# apps/ai-engine/agents/rule_engine/rules/rule_models.py

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class RuleSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH     = "high"
    MEDIUM   = "medium"
    LOW      = "low"


class RuleCategory(str, Enum):
    # Static
    FALSE_NEGATIVE = "false_negative"
    HALLUCINATION  = "hallucination"
    GRAMMAR        = "grammar"
    READABILITY    = "readability"
    CONSISTENCY    = "consistency"
    REPETITION     = "repetition"
    VERBOSITY      = "verbosity"
    LOGICAL_FLOW   = "logical_flow"
    AI_PATTERNS    = "ai_patterns"
    # Dynamic
    BRAND_VOICE     = "brand_voice"
    TONE            = "tone"
    WRITING_STYLE   = "writing_style"
    TARGET_AUDIENCE = "target_audience"
    INDUSTRY        = "industry_specific"
    CAMPAIGN        = "campaign_objective"
    SEO             = "seo_optimization"
    USER_PREF       = "user_preference"


class RuleType(str, Enum):
    STATIC  = "static"
    DYNAMIC = "dynamic"


class Rule(BaseModel):
    id:          str
    type:        RuleType
    category:    RuleCategory
    severity:    RuleSeverity
    name:        str
    description: str
    instruction: str
    weight:      float
    examples:    Optional[dict] = None


class RuleViolation(BaseModel):
    rule_id:     str
    rule_name:   str
    severity:    RuleSeverity
    category:    RuleCategory
    description: str
    location:    Optional[str] = None
    suggestion:  str


class ValidationResult(BaseModel):
    score:             float
    passed:            bool
    violations:        list[RuleViolation]
    passed_rules:      list[str]
    critical_failures: list[str]
    iteration:         int
    feedback:          str


class DynamicRuleSet(BaseModel):
    brand_id:     str
    request_id:   str
    generated_at: str
    rules:        list[Rule]
    context_used: dict


class RuleEngineResult(BaseModel):
    original_content:            str
    final_content:               str
    static_validation:           ValidationResult
    dynamic_rules:               DynamicRuleSet
    total_iterations:            int
    improvement_log:             list[dict]
    final_score:                 float
    processing_time_ms:          float
    false_negatives_eliminated:  int
