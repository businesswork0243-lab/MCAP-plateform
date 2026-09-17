# Human reference posts

**This folder needs 10–15 posts written by people. Nobody can generate them.**

Everything else in this corpus measures whether our output is getting worse.
Only this folder can tell us whether it is getting closer to how the people we
write for actually write. Without it, "the density fell" means the writing
changed, not that it improved.

## Why a model cannot fill this in

A post written by a model and filed here as human reference would set the
target to a model's writing. Every later comparison would then measure how
close our output sits to another model's output, and the number would look
healthy while meaning nothing. This is the one file in the repository where a
plausible-looking answer is worse than an empty folder.

The scorer refuses samples carrying chatbot residue — "Great question", "I hope
this helps", "as of my last update" — and CI fails on them. That catches the
obvious cases. It cannot catch a careful paste, so the honesty has to come from
whoever adds the file.

## What to add

Posts written by a person, before any AI editing. In order of usefulness:

1. **The brands we generate for.** Their founder's own LinkedIn posts, their
   blog, the copy they wrote before using M-CAP. This is the real target.
2. **People in the same field**, writing in the same format and register.
3. **Anything definitely human** as a distant third — writing published before
   2022 is a safe bet.

Aim for the same shape as what we generate: 100–400 words, the platform we
target, professional rather than personal.

## How to add one

One file per post, `.txt`, named `<brand-or-author>-<topic>-<platform>.txt`.

```
eval/corpus/human/cubane-founder-scaling-linkedin.txt
```

Paste the post exactly as published. Then record where it came from in a `---`
block at the top, which the scorer strips before measuring:

```
---
source: https://www.linkedin.com/posts/...
author: person's name
written: 2024-03-11
ai_involved: no — written and published by the author
---

The post text, exactly as published.
```

`ai_involved` is the line that matters. If a post was drafted by a model and
edited by a person, it does not belong here — say so and leave it out.

## Rules

- **Paste, do not tidy.** Fixing their typos changes what we are measuring.
- **No paraphrasing.** A rewritten post is your writing, not theirs.
- **Keep it short of a licence problem.** Quoting a few hundred words of a
  public post for internal measurement is fine; do not bulk-copy someone's blog.
- **Never delete a post to move the number.** The generated side is what we
  change.

## Checking your work

```bash
cd apps/ai-engine
python scripts/tell_score.py eval/corpus
```

The report prints the human side separately and the gap between the two. The
generated figure must not move when you add a file here — if it does, something
has gone into the wrong folder.

Once 10–15 posts are in:

```bash
python scripts/tell_score.py eval/corpus --save-baseline
```

That records the human figure alongside the baseline for context. It stays out
of the number CI checks, so reference posts can never loosen the gate.
