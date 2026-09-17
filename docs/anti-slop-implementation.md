# M-CAP Anti-Slop: Gap Analysis and What Changes After Implementation

**Status:** proposal, awaiting approval. No code has been changed for this document.
**Date:** 16 September 2026
**Sources read in full:** Wikipedia "Signs of AI writing" (raw wikitext, 1,928 lines, 106
sections); `blader/humanizer` SKILL.md + README.md (MIT); StoryScope, COLM 2026
(Russell, Rajendhran, Pham, Iyyer, Wieting).

---

## 1. Summary

M-CAP already stops the pipeline from **lying** — grounding rules, a QA grounding gate,
and brand documents that now actually parse. What it does not yet do is stop the pipeline
from **sounding like a machine**.

Today that defence is almost entirely vocabulary: a 42-phrase banned list plus rules
against negation contrasts and corporate buzzwords. All three sources agree this is the
layer that expires fastest. The layer that persists is structural: how a piece opens,
how it escalates, whether it explains its own meaning at the end, whether it ever speaks
to the reader.

After the five phases in this document, M-CAP moves from **3 of 25 known patterns covered**
to substantially all of them, gains a structural score that survives model changes, and
learns each brand's actual writing rhythm from their own documents instead of applying
one generic style rule to everybody.

---

## 2. Why this is the right thing to fix

### The durable layer vs the fleeting layer

StoryScope trained classifiers over 61,608 stories:

| Signal used | Detection (macro-F1) |
|---|---|
| Narrative structure only | **93.2%** |
| Style only | 85.8% |
| Both | 96.0% |

Then they ran an AI rewriter across the text to strip surface artifacts — clichés,
purple prose, redundant exposition. Detection fell from 95.5% to **93.9%**. A drop of
1.6 points. The structural choices were untouched because editing words does not change
how a piece is built.

The other two sources say the same thing from different directions:

- **Wikipedia** versions its vocabulary list by model era — GPT-4 words, GPT-4o words,
  GPT-5 words — because each release retires the previous set. The page carries a
  maintenance banner asking for an update "for the most recent models."
- **Humanizer** states it directly: *"Word habits change with every model release. The
  structural habits above persist, so they lead the list."*

### What that means for us concretely

Every phrase we add to the banned list has a shelf life of roughly one model generation.
Every structural rule we add keeps working. We should be spending effort on the second
kind, and we currently spend it almost entirely on the first.

---

## 3. Where M-CAP stands today (measured)

| Thing | Count | Where |
|---|---|---|
| Static rules | 17 | `SR000`–`SR016` |
| Banned phrases | 42 | `humanizer.BANNED_PHRASES` |
| QA dimensions | 10 | incl. `groundingScore` |
| Writing structures | 11 | thesis, story, listicle, … |
| Deterministic detector families | 5 | `ai_openings`, `buzzwords`, `false_negatives`, `hedging`, `transitions` |
| Tokens per generated piece | ~9,700 | measured, one LinkedIn post |
| Wall time per piece | ~40 s | measured, same run |

**What is already solid:** factual grounding. `SR014`–`SR016` catch invented experience,
role and project detail; QA scores `groundingScore` at 0.20 weight with a hard gate at 70;
the rule engine now fails closed instead of reporting a perfect score when the LLM is
unreachable. Verified end to end: a detailed profile produced zero invented claims, and a
near-empty profile produced impersonal analysis rather than a fabricated career.

**What is thin:** everything about how the writing *sounds*.

---

## 4. Gap analysis

### 4a. Pattern level — the 25 known tells

| # | Pattern | Status | Covered by |
|---|---|---|---|
| 1 | Not X but Y | **Covered** | `SR000`, `SR001`, regex |
| 2 | One-line closers, dramatic fragments | Missing | — |
| 3 | Sayings that sound deep | Missing | — |
| 4 | Staged run-up before the point | Partial | `ai_openings` |
| 5 | Arguing with no one | Missing | — |
| 6 | Forced triads | Missing | — |
| 7 | Repeated sentence openings | Missing | — |
| 8 | Dashes as universal connector | Missing | — |
| 9 | Stacked qualifiers | Partial | `hedging` |
| 10 | Hyphenated pairs everywhere | Missing | — |
| 11 | Passive voice / missing subjects | Missing | — |
| 12 | Overused AI words | **Covered** | 42-phrase list, `SR005` |
| 13 | Inflated significance | Missing | — |
| 14 | Vague connection or association | Missing | — |
| 15 | Shallow -ing riders | Missing | — |
| 16 | Sales language | Partial | `SR005` |
| 17 | Borrowed authority | Partial | `SR002`, `SR003` |
| 18 | Avoiding is / are / has | Missing | — |
| 19 | Bold as decoration | Missing | — |
| 20 | Decorative headings | Missing | — |
| 21 | Curly quotation marks | Missing | — |
| 22 | Chatbot residue | Missing | — |
| 23 | Knowledge-limit disclaimers | Missing | — |
| 24 | Heading repeated in first sentence | Missing | — |
| 25 | Writing about the previous version | Missing | — |

**3 covered · 4 partial · 18 missing.**

### 4b. Structure level — no representation at all

StoryScope quantifies how AI writing differs structurally. These gaps have no equivalent
check anywhere in M-CAP:

| Behaviour | AI | Human |
|---|---|---|
| Narrator explicitly states the theme | 77% | 52% |
| No subplots / single track | 79% | 57% |
| Resolution driven by protagonist's own choice | 69% | 46% |
| Emotion shown as bodily metaphor | 81% | 38% |
| Names specific references rather than vague allusions | 24% | 47% |
| Addresses the reader directly | 7% | 28% |

The marketing equivalents are obvious once stated: the post that ends by explaining its
own lesson, the argument that runs on one track with every example pointing the same way,
the piece that never once speaks to the person reading it.

### 4c. Pipeline level — who enforces what

| Stage | Enforces today | Gap |
|---|---|---|
| Canonical writer | Grounding contract, structure flow, negation ban, compliance rules, preferred terms | No tell list, no voice target |
| Platform optimizer | Must-preserve items, no new facts | No tell checking during compression |
| Brand optimizer | Banned phrases, preferred terms, compliance | Only the brand's own list |
| Humanizer | 42 phrases, negation regex, tone | 18 patterns unrepresented |
| Rule engine | 17 rules, regex false-negative pass, grounding gate | Style-heavy, no structure rules |
| QA | 10 dimensions incl. grounding | No writing-quality dimension |

**Evidence from our own current output.** A real canonical draft produced by the pipeline
during verification:

> Blockchain scalability has a measurement problem.
>
> Most teams benchmark throughput in transactions per second. They optimize consensus
> efficiency, compress signatures, and shard execution—as if the network were a single
> machine.
>
> But the binding constraint lives elsewhere.

This passed every check we have. It also contains three tells from the list above: an
em dash used as the connector (pattern 8), a forced triad (pattern 6), and a one-line
staged closer (pattern 2). None of them are detectable by anything M-CAP runs today.

---

## 5. What M-CAP becomes after implementation

### 5a. Stage by stage

| Stage | Today | After |
|---|---|---|
| Brand document upload | Parsed for facts | Also produces a **voice profile**: sentence length spread, dash rate, paragraph length, first-person rate, question rate |
| Canonical writer | Grounding + structure | Also receives the voice profile as a rhythm target and the top-5 tell list as hard constraints |
| Platform optimizer | Compression rules | Re-checked for tells introduced during compression |
| Humanizer | 42 phrases | ~20 detector families with **exact spans quoted back**, so the model fixes a named sentence rather than a category |
| Rule engine | 17 style rules | ~30 rules with strength ordering: strong patterns fail on one sighting, weak-alone ones only when they co-occur |
| QA | 10 dimensions | 11 — adds a structure/writing-quality score derived from the StoryScope method |
| Content page | Grounding %, QA warnings | Also a **tell report**: which patterns fired, in which sentence |

### 5b. The same draft, before and after

Taking the real output above, what changes is not the content but the construction:

**Today**
> Most teams benchmark throughput in transactions per second. They optimize consensus
> efficiency, compress signatures, and shard execution—as if the network were a single
> machine.
>
> But the binding constraint lives elsewhere.

**After** (illustrative — how the rules would push it)
> Most teams benchmark throughput in transactions per second, then optimise consensus
> and shard execution as though the network were one machine.
>
> The binding constraint is state growth: every transaction writes to it, and it never
> shrinks.

The triad collapses to what the meaning needs, the dash becomes a comma, and the staged
one-line closer is replaced by the actual claim it was delaying. Same facts, fewer tells,
more information per sentence.

### 5c. What the user sees

- A **Writing Quality** panel beside Factual Grounding, with the specific sentences that
  triggered each pattern rather than a bare score.
- A **voice match** indicator when a brand document exists: how close the output sits to
  that brand's measured rhythm.
- Nothing new blocks publishing by default. Grounding blocks because it is about truth.
  Writing quality warns, because it is about taste.

### 5d. What gets stored

- `brand_profiles.voice_profile` (JSONB) — measured once per document upload, cached.
- Tell report on the artifact alongside `quality_score`.
- A frozen evaluation corpus with tell density tracked per release.

---

## 6. How it works end to end

1. **Upload** — brand document parses; facts extracted as today, plus a voice profile.
2. **Brief** — user picks topic, structure, platforms as today.
3. **Canonical writer** — receives verified facts, compliance rules, preferred terms
   (all current), plus the voice profile and the strong tell list.
4. **Deterministic sweep** — regex detectors run on the draft. Free, instant, and they
   work when the LLM does not. Output is a list of spans.
5. **Platform adaptation** — must-preserve items enforced as today; the sweep runs again
   afterwards, because compression is where new tells appear.
6. **Brand pass** — banned phrases and terminology as today.
7. **Humanizer** — receives the exact offending spans and rewrites them, guided by the
   voice profile rather than a generic instruction.
8. **Rule engine** — validates against ~30 rules. Strong patterns cap below the pass mark
   and trigger regeneration; weak-alone patterns only deduct when they co-occur.
9. **QA** — scores 11 dimensions. Grounding gates. Writing quality reports.

**During an LLM outage:** steps 4 and 5 still function and still report. The rule engine
already fails closed, so nothing is marked clean that was never checked.

---

## 7. What we will be able to measure

None of these are promises; they are the numbers the evaluation set will make visible.

| Metric | Today | How it gets measured |
|---|---|---|
| Tells per 100 words | Unknown — cannot be measured | Deterministic sweep over the frozen corpus |
| Patterns covered | 3 of 25 | Same taxonomy, counted |
| Structure score | Does not exist | New QA dimension, threshold set from the corpus |
| Voice distance from brand sample | Does not exist | Measured rhythm vs brand's own document |
| Tokens per piece | ~9,700 | Adds roughly one scoring call in the final phase |

The important line in that table is the first one: **we currently cannot measure how
AI-sounding our output is.** Every claim about improvement is unfalsifiable until that
exists, which is why it is built first.

---

## 8. Risks and guardrails

- **Over-correction is the real danger.** Wikipedia warns that treating the signs as the
  problem "could just make detection harder" — you can strip every tell and still produce
  a piece that says nothing. Guardrail: measurement first, structure score advisory at
  launch, and human reference posts in the corpus so we are moving toward how people
  actually write rather than toward a low score.
- **StoryScope's features do not transfer directly.** Built for 5,000-word fiction with
  characters and plots. We take the method, re-derive the features for marketing.
- **We are not building an AI detector.** Wikipedia is explicit that detectors have
  non-trivial error rates and humans perform near chance. This score is an internal
  writing signal, never a public claim.
- **Weak-alone rules must stay weak.** Hyphen pairs, passive voice and copula avoidance
  are legitimate in technical writing. Enforcing them hard would damage exactly the
  content our users write most.
- **Licence.** Humanizer is MIT. Adopting its pattern text requires keeping the copyright
  notice — cleanest as a credited `PATTERNS.md` that the rules reference.

---

## 9. Order of work

| Phase | Work | Rough effort | Blocks anything? |
|---|---|---|---|
| P1 | Evaluation corpus + tell-density scorer in CI | ~2 days | No |
| P2 | Deterministic detectors for the 18 missing patterns | ~4 days | No |
| P3 | Pattern taxonomy into the rule engine (`SR017`+) | ~3 days | Regeneration only |
| P4 | Voice profile from brand documents | ~4 days | No |
| P5 | Structure scoring adapted from StoryScope | ~6 days | No (advisory) |

P1 and P2 together (~6 days) close most of the pattern gap and work during outages. P4
and P5 are the larger bets.

### Decisions needed before starting

1. Does the structure score ever block a piece, or only warn? *Recommendation: warn only,
   at least for the first month.*
2. Whose voice is the target when a brand has no document — require one, fall back to
   generic rules, or let the user paste 2–3 paragraphs directly?
3. Is ~19 days the right size, or do we ship P1+P2 first and re-decide?
4. Who supplies the human-written reference posts for the evaluation corpus? Without them
   we can measure change, but not direction.

---

## Appendix A — proposed rule IDs

| Range | Covers |
|---|---|
| `SR017`–`SR021` | Staging: one-line closers, deep-sounding sayings, staged run-up, arguing with no one, inflated significance |
| `SR022`–`SR026` | Rhythm: forced triads, repeated openings, dash overuse, stacked qualifiers, hyphen pairs |
| `SR027`–`SR030` | Inflation: vague association, -ing riders, sales language, copula avoidance |
| `SR031`–`SR034` | Formatting and residue: bold decoration, decorative headings, chat residue, heading echo |

## Appendix B — candidate structure features for marketing

Each a closed question with fixed options, scored in one call:

1. Does the closing paragraph state the piece's own meaning?
2. Are all examples hypothetical, or is at least one concrete and named?
3. Does the argument run on a single track, or does it hold a real counter-case?
4. Does the text address the reader at any point?
5. Are references named, or vague allusions?
6. Does emotion arrive as bodily metaphor or as a plain statement?
7. Is the resolution driven by the subject's own choice, or by external conditions?
8. Does the opening stage importance or state a fact?
9. Is there a moral or lesson explicitly spelled out?
10. Does the piece acknowledge uncertainty anywhere?
11. Is the causal chain unbroken end to end, or does it admit messiness?
12. Does every paragraph advance the argument, or do some restate it?
13. Is there a concrete number, date or name the reader could check?
14. Does the piece use the brand's own terminology?
15. Would a reader learn something they could not have guessed from the headline?

## Appendix C — sources

- Wikipedia, *Signs of AI writing* — <https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing>
- blader/humanizer (MIT) — <https://github.com/blader/humanizer>
- Russell, Rajendhran, Pham, Iyyer, Wieting, *StoryScope: Investigating idiosyncrasies in
  AI fiction*, COLM 2026 — <https://github.com/jenna-russell/storyscope>

Baseline figures measured against the codebase on 16 September 2026. Effort estimates are
judgement, not measurement.
