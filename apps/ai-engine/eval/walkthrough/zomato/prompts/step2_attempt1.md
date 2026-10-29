# platform_optimizer

## SYSTEM

You extract a writing brief from an article so that several different formats can be written from it without repeating each other.
Return ONLY valid JSON. Use only what the article says; add nothing.

## USER

ARTICLE:
# The Menu Was the Product

In 2008, two founders built a website that published restaurant menus. Foodiebay solved a narrow, visible problem: people at work wanted to browse menus without hunting through paper. No ordering. No delivery. No logistics. Just a searchable catalogue.

That catalogue became Zomato in 2010. By 2015, food ordering and delivery had become the central growth engine. FY2025–26 annual-report materials record 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners and 552,000 average monthly active delivery partners.

**The challenge.** A directory has no operational burden. A delivery marketplace inherits every failure point: restaurant preparation times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food will arrive in condition and on time." That promise depends on partners the platform does not employ and cannot fully control.

**The approach.** Zomato built the marketplace around three coordinated networks: consumers, restaurant partners and delivery partners. Local density became the operating unit: restaurant availability, demand and delivery capacity vary by neighbourhood. Monetisation followed the transaction: commissions, customer fees, advertising, subscriptions. Operations became part of the product, with dispatch, partner onboarding, service quality and fraud controls sitting alongside search and checkout.

**The results.** The scale is documented: hundreds of Indian cities, hundreds of thousands of restaurant and delivery partners, nearly a billion orders in a financial year. The corporate structure also evolved: Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato.

**Lessons for founders.** Start with a problem small enough to solve completely, then earn the right to the adjacent one. Treat operations as product surface, because the customer experiences your supply chain directly. Build for local density before national scale. And keep the consumer brand distinct from the corporate entity as the portfolio widens.

Which adjacent problem is your current product earning the right to solve?

Return JSON with exactly these keys:
{
  "thesis": "the single claim of the piece, one sentence, in plain words",
  "reader": "who this is for and what they currently believe or do",
  "points": ["3 to 6 distinct supporting points, each one sentence, in the order of the argument"],
  "evidence": ["concrete details the article gives: mechanisms, numbers, named cases, examples. Empty list if none"],
  "quotable": ["2 to 4 short lines from the article worth quoting as written"],
  "cta": "what the article asks the reader to do, or empty string"
}

## RESPONSE

{
  "thesis": "A company should start by solving a small, visible problem completely, then earn the right to tackle adjacent problems by treating operations as part of the product and building for local density before national scale.",
  "reader": "Founders and startup operators who are deciding which problem to solve next or how to scale their current product.",
  "points": [
    "Zomato began as Foodiebay in 2008, a simple searchable catalogue of restaurant menus that solved a narrow, visible problem without any operational burden.",
    "When the company added food ordering and delivery, it inherited every failure point of a delivery marketplace, shifting its promise from showing menus to guaranteeing on-time, in-condition delivery.",
    "Zomato built its marketplace around three coordinated networks—consumers, restaurant partners, and delivery partners—and made local density the operating unit because restaurant availability, demand, and delivery capacity vary by neighbourhood.",
    "Monetisation followed the transaction through commissions, customer fees, advertising, and subscriptions, while operations such as dispatch, partner onboarding, service quality, and fraud controls became part of the product alongside search and checkout.",
    "The scale is documented: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, and 552,000 average monthly active delivery partners in FY2025–26.",
    "The corporate structure evolved—Zomato Limited became Eternal Limited in March 2025 with Blinkit, District, and Hyperpure as sibling businesses—while the consumer brand stayed Zomato, showing the importance of keeping the consumer brand distinct as the portfolio widens."
  ],
  "evidence": [
    "Foodiebay was founded in 2008 and became Zomato in 2010.",
    "By 2015, food ordering and delivery had become the central growth engine.",
    "FY2025–26 annual-report materials record 979 million food-delivery orders.",
    "24.3 million average monthly transacting customers.",
    "330,000 average monthly active restaurant partners.",
    "552,000 average monthly active delivery partners.",
    "Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses.",
    "The consumer brand stayed Zomato."
  ],
  "quotable": [
    "Start with a problem small enough to solve completely, then earn the right to the adjacent one.",
    "Treat operations as product surface, because the customer experiences your supply chain directly.",
    "Build for local density before national scale.",
    "Keep the consumer brand distinct from the corporate entity as the portfolio widens."
  ],
  "cta": "Which adjacent problem is your current product earning the right to solve?"
}

# platform_optimizer

## SYSTEM

You are a writer who has published on every channel you are asked to write for.
You write each piece as if it had been written for that channel from the start. You do not summarise an article and you do not paste excerpts from it.

THE ONE RULE THAT OVERRIDES THE REST: you may not add any fact, number, name, credential, anecdote or experience that is not in the source material. You may rephrase, reorder, cut, emphasise and put things in new words. Where the source is vague, stay vague. If a format asks for something the source does not contain (a testimonial, a statistic, a bio), leave it out or mark the slot, never invent it.

HOW YOU WRITE
- Start from the idea, not from the article's sentences. Say it in this format's own voice.
- Be specific. Every piece contains at least one concrete detail from the source (a mechanism, a number, a named case). A piece that is all claims and no detail is not finished.
- One thesis per piece. If the format is short, drop points; do not compress all of them into slogans.
- Vary sentence length. Do not build a piece from a run of very short lines, and do not end paragraphs on a line that only restates the one before it.
- Say what something is. Do not set up a contrast by first saying what it is not.
- Plain words. No filler openers such as "In today's world", and none of: leverage, unlock, transformative, seamless, robust, game-changer.
- Any MUST-PRESERVE item in the prompt survives into the piece.

OUTPUT: the finished piece only. No preamble, no labels such as "Here is", no commentary.

## USER

Write a LinkedIn Post from the material below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WRITING BRIEF (the ideas to work from)
Thesis: A company should start by solving a small, visible problem completely, then earn the right to tackle adjacent problems by treating operations as part of the product and building for local density before national scale.
Reader: Founders and startup operators who are deciding which problem to solve next or how to scale their current product.
Points:
  - Zomato began as Foodiebay in 2008, a simple searchable catalogue of restaurant menus that solved a narrow, visible problem without any operational burden.
  - When the company added food ordering and delivery, it inherited every failure point of a delivery marketplace, shifting its promise from showing menus to guaranteeing on-time, in-condition delivery.
  - Zomato built its marketplace around three coordinated networks—consumers, restaurant partners, and delivery partners—and made local density the operating unit because restaurant availability, demand, and delivery capacity vary by neighbourhood.
  - Monetisation followed the transaction through commissions, customer fees, advertising, and subscriptions, while operations such as dispatch, partner onboarding, service quality, and fraud controls became part of the product alongside search and checkout.
  - The scale is documented: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, and 552,000 average monthly active delivery partners in FY2025–26.
  - The corporate structure evolved—Zomato Limited became Eternal Limited in March 2025 with Blinkit, District, and Hyperpure as sibling businesses—while the consumer brand stayed Zomato, showing the importance of keeping the consumer brand distinct as the portfolio widens.
Evidence:
  - Foodiebay was founded in 2008 and became Zomato in 2010.
  - By 2015, food ordering and delivery had become the central growth engine.
  - FY2025–26 annual-report materials record 979 million food-delivery orders.
  - 24.3 million average monthly transacting customers.
  - 330,000 average monthly active restaurant partners.
  - 552,000 average monthly active delivery partners.
  - Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses.
  - The consumer brand stayed Zomato.
Lines worth quoting (use at most one, exactly as written):
  - Start with a problem small enough to solve completely, then earn the right to the adjacent one.
  - Treat operations as product surface, because the customer experiences your supply chain directly.
  - Build for local density before national scale.
  - Keep the consumer brand distinct from the corporate entity as the portfolio widens.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL ARTICLE (source of truth for every fact; do not copy its sentences)
# The Menu Was the Product

In 2008, two founders built a website that published restaurant menus. Foodiebay solved a narrow, visible problem: people at work wanted to browse menus without hunting through paper. No ordering. No delivery. No logistics. Just a searchable catalogue.

That catalogue became Zomato in 2010. By 2015, food ordering and delivery had become the central growth engine. FY2025–26 annual-report materials record 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners and 552,000 average monthly active delivery partners.

**The challenge.** A directory has no operational burden. A delivery marketplace inherits every failure point: restaurant preparation times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food will arrive in condition and on time." That promise depends on partners the platform does not employ and cannot fully control.

**The approach.** Zomato built the marketplace around three coordinated networks: consumers, restaurant partners and delivery partners. Local density became the operating unit: restaurant availability, demand and delivery capacity vary by neighbourhood. Monetisation followed the transaction: commissions, customer fees, advertising, subscriptions. Operations became part of the product, with dispatch, partner onboarding, service quality and fraud controls sitting alongside search and checkout.

**The results.** The scale is documented: hundreds of Indian cities, hundreds of thousands of restaurant and delivery partners, nearly a billion orders in a financial year. The corporate structure also evolved: Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato.

**Lessons for founders.** Start with a problem small enough to solve completely, then earn the right to the adjacent one. Treat operations as product surface, because the customer experiences your supply chain directly. Build for local density before national scale. And keep the consumer brand distinct from the corporate entity as the portfolio widens.

Which adjacent problem is your current product earning the right to solve?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT: LinkedIn Post   LENGTH: 150-300 words

THIS BRAND'S MEASURED WRITING RHYTHM:
  - Sentences average 14.2 words (shortest 2, longest 95).
  - Length varies widely (spread 8.4). Mix short lines with long ones; do not settle into an even rhythm.
  - Paragraphs run about 22.8 sentences.
  - Avoids first person. Keep the writing impersonal.
  - Uses dashes sparingly (0.87 per 100 words) — do not exceed this.
Treat this as the rhythm to write toward, in your own sentences. If the brand writes in first person and the article contains first-person statements ('we', 'our'), a first-person line that restates one of them in new words suits the voice. Never add a first-person claim the article does not make.

HOW TO WRITE IT
Write it as a post a practitioner would publish, from one idea in the brief. The first line has to stand alone before the 'see more' fold: a specific claim, number or tension, never a greeting or a definition. Develop that one idea with one concrete mechanism or example from the draft. Close with a single question the reader can answer from their own work, or the CTA.

FORMAT RULES
  - Paragraphs of one to three sentences, a blank line between them
  - Vary sentence length; do not make every paragraph one short line
  - 3-5 hashtags on the last line only
  - No bullet-point lists
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MUST-PRESERVE (from the original request; these survive the cut):
AUDIENCE EMPHASIS: execution insights, growth lessons, builder mindset

AVOID IN THIS PIECE: academic theory

AUDIENCE NOTE:
Raw, honest, founder-to-founder voice

CALL TO ACTION:
End with an open question inviting readers to share their perspective.

TARGET LENGTH: about 350 words.

Write the LinkedIn Post now:

## RESPONSE

Foodiebay in 2008 was a website that published restaurant menus. No ordering, no delivery, no logistics. A searchable catalogue that solved one narrow, visible problem: people at work wanted to browse menus without hunting through paper.

That restraint is the lesson. A directory carries no operational burden. The moment Zomato added ordering and delivery, it inherited every failure point of a marketplace: restaurant prep times, courier supply, routing, weather, refunds, support. The promise shifted from "here is the menu" to "your food will arrive in condition and on time," and that promise rests on partners the platform does not employ and cannot fully control.

The response was to stop treating operations as back office. Dispatch, partner onboarding, service quality and fraud controls were built as product surface, sitting alongside search and checkout, because the customer experiences the supply chain directly.

Zomato also made local density the operating unit rather than the city or the country. Restaurant availability, demand and delivery capacity vary by neighbourhood, so that is where the marketplace was built. The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners.

Monetisation followed the transaction, through commissions, customer fees, advertising and subscriptions. And when Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses, the consumer brand stayed Zomato.

Start with a problem small enough to solve completely, then earn the right to the adjacent one.

Which adjacent problem is your current product earning the right to solve?

#Startups #Founders #ProductStrategy #Operations #Growth