# AI writing patterns — sources and attribution

The tell taxonomy in `apps/ai-engine/services/tells.py` is adapted from two
sources. This file exists to credit them properly and to record what we changed.

## blader/humanizer (MIT)

<https://github.com/blader/humanizer>

The 25-pattern taxonomy, the numbering, and the strong / *weak alone*
distinction come from this skill. Our `tells.py` follows its pattern numbers so
the two can be read side by side: our `TELL06` is its pattern 6, forced triads.

```
MIT License

Copyright (c) blader/humanizer contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Wikipedia: Signs of AI writing (CC BY-SA 4.0)

<https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing>

The underlying field guide, and the source of the versioned vocabulary lists.
Its own caveats are worth repeating, because they shaped how we built this:

- Detection tools have non-trivial error rates, and humans perform near chance.
  Our score is an internal writing signal, never a public claim.
- "Please do not merely treat these signs as the problems to be fixed; that
  could just make detection harder." A piece can lose every tell and still say
  nothing.

## StoryScope (COLM 2026)

<https://github.com/jenna-russell/storyscope> — Russell, Rajendhran, Pham,
Iyyer, Wieting.

Not used for patterns. Used for the argument that structure outlasts style, and
later for the structure-scoring method in P5. Its 304 features are built for
5,000-word fiction and do not transfer to marketing copy directly.

## What we changed

| Their taxonomy | Ours | Why |
|---|---|---|
| Pattern 1, not X but Y | Not duplicated | Already covered by `SR000`, `SR001` and `text_cleaner.detect_false_negatives` |
| Pattern 12, overused AI words | Not duplicated | Already covered by `humanizer.BANNED_PHRASES` (42 entries) |
| Pattern 25, writing about the previous version | Omitted | Too many false positives on release notes and changelogs, which our users write |
| Prose guidance for a human editor | Regex detectors returning spans | A rewriting model needs the offending sentence, not a category name |
| "weak alone" as advice | `solo_threshold` per pattern | Made explicit: a weak pattern counts when it clears its own threshold or when two different weak patterns appear together |
