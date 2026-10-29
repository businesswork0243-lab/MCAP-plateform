# dynamic_rule_gen

## SYSTEM

You are a content strategy expert.
You create precise, actionable writing rules based on brand identity
and campaign context.

Generate rules that are:
- Specific and measurable by an LLM validator
- Unique to the brand/audience provided
- Different from universal quality rules (grammar, false negatives, hallucinations)
- Directly tied to the content objective

Return ONLY valid JSON. No markdown, no explanation.

## USER

Analyze this content request and generate 5-7 specific writing rules.

## Context:
{
  "user_request": "How a menu directory turned into everyday food delivery, and what founders can take from it",
  "brand": {
    "name": "Zomato",
    "industry": "Food delivery / food-tech",
    "voice": "Conversational, witty and culturally aware in marketing; clear and empathetic on service and safety",
    "target_audience": "Urban Indian consumers, restaurant partners, founders and product teams",
    "banned_phrases": [
      "delivery boys",
      "game-changing",
      "disrupt",
      "unbeatable"
    ],
    "preferred_terms": [
      "delivery partners",
      "restaurant partners",
      "Eternal Limited"
    ]
  },
  "campaign": {
    "platform": "linkedin_post",
    "objective": "Build thought leadership",
    "content_type": "article",
    "keywords": [],
    "cta": "invite_discussion"
  }
}

## Required Response Format:
{
  "rules": [
    {
      "category":    "brand_voice|tone|writing_style|target_audience|industry|campaign|seo|user_preference",
      "severity":    "critical|high|medium|low",
      "name":        "Rule name (max 5 words)",
      "description": "What this rule ensures",
      "instruction": "Exact instruction for LLM validator to check compliance",
      "weight":      0.08,
      "examples": {
        "good": "Example following this rule",
        "bad":  "Example violating this rule"
      }
    }
  ]
}

IMPORTANT:
- Use ONLY these category values: brand_voice, tone, writing_style, target_audience, industry, campaign, seo, user_preference
- Do NOT duplicate static rules (grammar, false negatives, hallucinations)
- Focus ONLY on brand-specific and audience-specific standards
- Each rule must be uniquely checkable
- Rules must suit the platform in the context. Do not write rules about length, headings or paragraph count unless the request itself sets them, and never ask a short format for what only a long one can show
- Never mark a rule "critical"; use "high" for the most important
- Return ONLY valid JSON

## RESPONSE

{
  "rules": [
    {
      "category": "brand_voice",
      "severity": "high",
      "name": "Use preferred partner terminology",
      "description": "Ensures respectful and brand-aligned language when referring to delivery personnel and restaurants.",
      "instruction": "Check that the article uses 'delivery partners' instead of 'delivery boys' or similar, and 'restaurant partners' instead of 'vendors' or 'restaurants' when referring to partners. Flag any occurrence of banned phrases: 'delivery boys', 'game-changing', 'disrupt', 'unbeatable'.",
      "weight": 0.2,
      "examples": {
        "good": "Our delivery partners are the backbone of the operation.",
        "bad": "Delivery boys are the backbone of the operation."
      }
    },
    {
      "category": "tone",
      "severity": "high",
      "name": "Conversational yet professional tone",
      "description": "Maintains a witty and culturally aware voice suitable for LinkedIn thought leadership without being overly casual.",
      "instruction": "Assess the overall tone: it should be conversational (e.g., use of contractions, relatable anecdotes) but remain professional and insightful. Avoid slang, excessive humor, or informal abbreviations. The tone should reflect Zomato's marketing voice: witty and culturally aware, but clear and empathetic.",
      "weight": 0.15,
      "examples": {
        "good": "Remember when ordering food meant calling a restaurant and hoping for the best? Those days feel like ancient history.",
        "bad": "OMG, remember when we had to call restaurants? LOL, so archaic!"
      }
    },
    {
      "category": "target_audience",
      "severity": "high",
      "name": "Address founders and product teams",
      "description": "Tailors content to the primary audience of founders and product teams, providing actionable insights and strategic lessons.",
      "instruction": "Check that the article explicitly addresses founders and/or product teams, offering takeaways, lessons, or strategic advice relevant to building and scaling products. Look for phrases like 'founders can learn', 'product teams should consider', or direct advice. The content should not be generic; it must include at least one clear takeaway for this audience.",
      "weight": 0.2,
      "examples": {
        "good": "For founders, the key lesson is to stay close to user behavior and iterate quickly.",
        "bad": "This is a story about food delivery."
      }
    },
    {
      "category": "campaign",
      "severity": "high",
      "name": "Invite discussion in CTA",
      "description": "Encourages audience engagement by including a clear call-to-action that invites discussion, as per campaign objective.",
      "instruction": "Verify that the article ends with a call-to-action that explicitly invites readers to share their thoughts, ask questions, or engage in discussion. The CTA should be phrased as an invitation, e.g., 'What are your thoughts?', 'Share your experiences in the comments.', or 'Join the conversation.'",
      "weight": 0.15,
      "examples": {
        "good": "What lessons have you drawn from similar pivots? Share your thoughts in the comments below.",
        "bad": "Thanks for reading."
      }
    },
    {
      "category": "writing_style",
      "severity": "medium",
      "name": "Narrative with actionable insights",
      "description": "Structures the article as a narrative that tells the story of Zomato's evolution while extracting practical lessons for founders.",
      "instruction": "Check that the article follows a narrative arc: it should describe the transformation from menu directory to food delivery, and then explicitly draw out lessons or takeaways for founders. The narrative should be clear and chronological, and the insights should be directly linked to the story.",
      "weight": 0.1,
      "examples": {
        "good": "From a simple menu directory to a household name in food delivery, Zomato's journey offers three key lessons for founders.",
        "bad": "Zomato started as a menu directory and now does food delivery. Founders should learn from it."
      }
    },
    {
      "category": "industry",
      "severity": "medium",
      "name": "Reference food-tech context",
      "description": "Grounds the article in the food-tech industry by referencing relevant trends, challenges, or milestones.",
      "instruction": "Ensure the article includes at least one specific reference to the food-tech industry, such as mentioning restaurant digitization, logistics, user reviews, or market expansion. The reference should be accurate and relevant to Zomato's context.",
      "weight": 0.1,
      "examples": {
        "good": "The shift to online ordering required building a robust logistics network and partnering with restaurants for digitized menus.",
        "bad": "The company grew by expanding its services."
      }
    },
    {
      "category": "user_preference",
      "severity": "medium",
      "name": "Mention Eternal Limited appropriately",
      "description": "Incorporates the preferred term 'Eternal Limited' where relevant, reflecting the brand's corporate structure.",
      "instruction": "Check that if the article refers to the parent company or corporate entity, it uses 'Eternal Limited' instead of 'Zomato' or other names. If the article does not mention the corporate entity, this rule is not applicable. Do not force the term if not needed.",
      "weight": 0.1,
      "examples": {
        "good": "Eternal Limited, the parent company of Zomato, has been at the forefront of this evolution.",
        "bad": "Zomato, as a company, has been at the forefront of this evolution."
      }
    }
  ]
}

# static_validator

## SYSTEM

You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation.

## USER


⚠️  PRIORITY: CRITICAL — FALSE NEGATIVES

Evaluate this content against the rules below.

## Format
This piece is a LinkedIn Post (150-300 words). Its conventions are intended; judge it as that format, not as an essay.

## Rules:
[
  {
    "id": "SR000",
    "name": "Zero False Negatives",
    "severity": "critical",
    "category": "false_negative",
    "type": "static",
    "instruction": "Scan the ENTIRE content for these EXACT patterns and flag EVERY instance:\n\nFORBIDDEN PATTERNS:\n  1. 'It's not just X, it's Y'\n  2. 'This isn't just about X, it's about Y'\n  3. 'It's not merely X, it's Y'\n  4. 'Not only does it X, but it also Y'\n  5. 'More than just X'\n  6. 'Far from being X'\n  7. 'Rather than being X, it's Y'\n  8. 'This isn't your typical X'\n  9. 'It's less about X and more about Y'\n 10. 'Not a X, but a Y'\n 11. 'Not about X, it's about Y'\n 12. 'Isn't just about'\n 13. 'Not just about'\n 14. 'More than just'\n 15. 'Not merely'\n\nIf ANY of these patterns appear even once \u2014 rule is VIOLATED.\nQuote the EXACT sentence in 'location'.",
    "examples": {
      "bad_1": "Blockchain isn't just about crypto, it's about trust.",
      "good_1": "Blockchain builds trust through cryptography.",
      "bad_2": "Not only does it scale, but it also secures.",
      "good_2": "It scales and secures simultaneously.",
      "bad_3": "This is more than just a feature.",
      "good_3": "This feature drives the entire strategy.",
      "bad_4": "It's not merely a tool, it's a mindset.",
      "good_4": "It requires a fundamental mindset shift."
    }
  },
  {
    "id": "SR001",
    "name": "No Contrast Negation",
    "severity": "critical",
    "category": "false_negative",
    "type": "static",
    "instruction": "Check for these contrast negation patterns:\n  - 'not X, but Y' (e.g., 'not a cost, but an investment')\n  - 'less X, more Y' (e.g., 'less about features, more about experience')\n  - 'not X \u2014 Y' (with em-dash as separator)\n  - 'forget X, think Y'\n  - 'instead of X, think Y'\n  - 'rather than X, Y'\n\nIf found, mark VIOLATED and quote exact sentence in 'location'.",
    "examples": {
      "bad": "It's not a cost, it's an investment.",
      "good": "It pays for itself within a quarter."
    }
  }
]

## Content:
"""
Foodiebay published restaurant menus. No ordering, no delivery, no logistics. In 2008 that was the whole product, and it worked because the problem was small enough to solve completely.

Then it became Zomato in 2010, and by 2015 delivery was the growth engine. That move changed what the company had to be good at. A directory carries no operational burden. A delivery marketplace inherits every failure point: prep times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food arrives on time and in condition," and that promise depends on partners the platform does not employ.

How Zomato responded is the part worth studying. It built around three coordinated networks: consumers, restaurant partners, delivery partners. Local density became the operating unit, because restaurant availability, demand and delivery capacity all vary by neighbourhood. Dispatch, partner onboarding, service quality and fraud controls moved in alongside search and checkout. Operations became part of the product surface, not a cost centre behind it.

The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners, across hundreds of Indian cities.

The corporate structure moved too. Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato, kept distinct from the entity as the portfolio widened.

The lesson for founders deciding what to build next: start with a problem small enough to solve completely, then earn the right to the adjacent one. Density before national scale. And when the portfolio widens, keep the consumer brand separate from the corporate one.

Which adjacent problem is your current product earning the right to solve?

#Startups #ProductStrategy #Operations #Founders #Scaling
"""

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{
  "violations": [
    {
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }
  ]
}

If nothing is violated, return {"violations": []}.
Return ONLY valid JSON

## RESPONSE

{"violations": []}

# static_validator

## SYSTEM

You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation.

## USER


Evaluate this content against the rules below.

## Format
This piece is a LinkedIn Post (150-300 words). Its conventions are intended; judge it as that format, not as an essay.

## Verified brand material
A claim that restates this material is SUPPORTED and is not a violation, including a company-voice 'we' or 'our' about things it states. Flag only claims that go beyond it.
"""
Name: Zomato
Industry: Food delivery / food-tech
Key messages: Better food for more people; Operations are part of the product

UPLOADED BRAND DOCUMENT:
ZOMATO
A to Z Brand & Business
Research Report
Company history • Brand identity • Business model • Products •
Marketing • Operations • Financial snapshot • Competition •
Risks • Future outlook
Prepared in English | Research cut-off: 28 October 2026

Zomato Brand & Business Research | Educational use
Page 2
An independent educational and business research report.
Zomato is a brand of Eternal Limited; this report is not an official
company publication.

Zomato Brand & Business Research | Educational use
Page 3
How to use this report
This report is designed as a broad, practical guide to Zomato for students, founders, marketers, product teams
and business researchers. It covers the brand and its food-delivery business while distinguishing Zomato from its
listed parent company, Eternal Limited.
Important distinction: Zomato remains the consumer-facing food-ordering and delivery
brand. The listed parent company changed its name from Zomato Limited to Eternal
Limited in March 2025. Blinkit, District and Hyperpure are sibling businesses within the
wider group, not simply features of the Zomato food-delivery app.
Contents
1. Executive summary
2. Company overview and A-to-Z profile
3. Founding story and timeline
4. Brand purpose, positioning and promise
5. Brand identity and communication style
6. Products and customer experience
7. Business model and revenue streams
8. How the delivery marketplace works
9. Marketing and growth strategy
10. Technology and data
11. Stakeholders and operating model
12. Competitive landscape
13. Financial and operating snapshot
14. SWOT analysis
15. Key risks and challenges
16. Sustainability and social impact
17. Strategic opportunities and outlook
18. Brand lessons and practical takeaways
19. Glossary
20. Sources and research notes

Zomato Brand & Business Research | Educational use
Page 4
1. Executive summary
Zomato is one of India's best-known food-tech brands. It began in 2008 as Foodiebay, a digital restaurant-menu
discovery service created by Deepinder Goyal and Pankaj Chaddah. The early product helped people find
restaurant menus and make dining decisions; the business later expanded into online food ordering and delivery.
The brand's core proposition is convenience and discovery: help customers find food they want, compare
options, place an order, pay, and receive it through a coordinated network of restaurants and independent
delivery partners. The business depends on marketplace liquidity, restaurant selection, customer trust, delivery
reliability, local density, pricing and repeat usage.
At the corporate level, Zomato is now part of Eternal Limited. Eternal's broader portfolio also includes Blinkit
(quick commerce), District (going-out and ticketing experiences), and Hyperpure (B2B supplies). This structure
matters when reading group-level financial results: not every Eternal metric is a Zomato food-delivery metric.
FY2026 operating metrics published in the company's FY2025–26 annual-report materials show 979 million
food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active
restaurant partners and 552,000 average monthly active delivery partners. These figures describe the financial
year ended 31 March 2026, not a live daily count.
The central strategic challenge is to grow orders and customer value while keeping delivery economics healthy,
maintaining restaurant and delivery-partner relationships, managing customer expectations, and defending share
in a highly competitive market.
Key source: Eternal annual-report materials and the company's official Zomato business page. See Sources and research notes.
2. Company overview and A-to-Z profile
Item
Summary
Brand
Zomato — consumer-facing food discovery, ordering and delivery platform.
Founded
2008; originally launched as Foodiebay.
Founders
Deepinder Goyal and Pankaj Chaddah.
Parent / listed entity
Eternal Limited (formerly Zomato Limited); company name changed in March 2025.
Core market
India food ordering and delivery; operations span hundreds of Indian cities.
Core users
Consumers, restaurant partners and independent delivery partners.
Core value proposition
Restaurant discovery, menu choice, ordering convenience, digital payment and last-mile delivery.
Related group businesses
Blinkit (quick commerce), District (going-out / entertainment experiences), Hyperpure (B2B
supplies).
Official web presence
zomato.com; corporate and investor information at eternal.com.
Brand purpose statement
“Better food for more people” — as stated on the official Zomato business page.
Category
Consumer internet / food-tech / online marketplace and last-mile logistics coordination.
Business type
Multi-sided marketplace supported by technology, local operations and partner networks.
A-to-Z quick index
A — Audience: Consumers looking for meals; restaurants seeking reach and orders; delivery partners seeking
earning opportunities.
B — Brand: A high-recognition consumer brand associated with food discovery and delivery.

Zomato Brand & Business Research | Educational use
Page 5
C — Customers: Customer experience includes choice, price transparency, order tracking, packaging and
support.
D — Delivery: A last-mile network coordinates pickup and drop-off; traffic and weather affect reliability.
E — Experience: Search, menus, filters, ratings, checkout, tracking, support and repeat ordering.
F — Founding: Foodiebay started as a digital restaurant-menu directory in 2008.
G — Growth: Expansion from discovery into ordering, delivery, subscriptions and adjacent group businesses.
H — Hyperpure: A separate group B2B supply business serving restaurants and food businesses.
I — Innovation: Personalisation, search, recommendation, routing, support tooling and healthy-food discovery.
J — Jobs & livelihoods: The marketplace creates economic activity for restaurants and delivery partners;
quality and security remain important.
K — Key metrics: Orders, transacting customers, average order value, resta
"""

## Rules:
[
  {
    "id": "SR002",
    "name": "No Fabricated Statistics",
    "severity": "critical",
    "category": "hallucination",
    "type": "static",
    "instruction": "Check for suspicious statistics that appear fabricated:\n  - Overly specific percentages without source (e.g., '73.6% of users')\n  - Precise dollar figures with no attribution\n  - 'Studies show...' without naming the study\n  - 'Research proves...' without citation\n  - 'According to experts...' with no named expert\n\nFlag any statistic that looks invented or unverifiable.",
    "examples": {
      "bad": "Studies show 87.3% of marketers prefer this approach.",
      "good": "Many marketers have shifted to this approach."
    }
  },
  {
    "id": "SR003",
    "name": "No False Attributions",
    "severity": "critical",
    "category": "hallucination",
    "type": "static",
    "instruction": "Check if any quotes are attributed to real individuals or brands.\nLook for: 'As [Person] said...', '[Famous Person] once noted...'\nUnless the quote was explicitly provided in the input context,\nflag any attributed quote as a potential false attribution.",
    "examples": {
      "bad": "As Steve Jobs said, 'Content is king.'",
      "good": "Great content, like great design, prioritizes the user."
    }
  },
  {
    "id": "SR014",
    "name": "No Invented Personal Experience",
    "severity": "critical",
    "category": "hallucination",
    "type": "static",
    "instruction": "The content is published under a real person's name. Flag any first-person claim that the verified profile does not support:\n  - Duration of experience ('a decade in this space', 'for years')\n  - Companies founded, owned, advised, or worked at\n  - Teams, colleagues, clients, employees or mentees\n  - Specific incidents: bugs, outages, launches, deployments\n  - Named frameworks or methods credited to the author\n  - Emotional turning points and 'lessons learned'\n\nIf no verified profile was supplied, flag EVERY first-person experience claim. An engaging story built on invented experience is a critical failure, not a stylistic preference.\n\nTwo things are NOT violations:\n  - A claim that restates the 'Verified brand material' section, including the uploaded brand document, whether it is written as 'we', 'our', 'I' or in the third person ('a fund once lost three days' when the document says so). Check that section before flagging anything.\n  - Opinion and rhetorical first person: 'I think', 'I would argue', 'let me be direct', 'I should be honest'. Only claims of FACT about the author or their organisation count.",
    "examples": {
      "bad": "I have spent the better part of a decade building infrastructure, and I recall a protocol I advised.",
      "good": "Infrastructure teams repeatedly hit the same constraint at this layer."
    }
  },
  {
    "id": "SR015",
    "name": "No Invented Role or Seniority",
    "severity": "critical",
    "category": "hallucination",
    "type": "static",
    "instruction": "Check how the content positions the author. Flag any role or seniority the profile does not state:\n  - 'As a founder...' when the profile says employee or engineer\n  - 'As a CTO/CEO...' with no such title in the profile\n  - Implied decision-making authority the profile does not grant\n  - Advisory or board positions absent from the profile\n\nThe narrative perspective setting is a voice instruction, not a licence to claim a job the author does not hold.",
    "examples": {
      "bad": "As a founder, I had to choose between throughput and modularity.",
      "good": "That trade-off between throughput and modularity is decided early."
    }
  },
  {
    "id": "SR016",
    "name": "No Invented Project Detail",
    "severity": "critical",
    "category": "hallucination",
    "type": "static",
    "instruction": "When the content describes a project the author built, flag any specifics the profile does not confirm:\n  - Algorithms, protocols or data structures not named in it\n  - Node counts, throughput, latency or scale figures\n  - Contract functions, incentive or penalty mechanics\n  - Security guarantees and detection claims\n\nKnowing which technologies someone used does not establish HOW they used them. A verified technology list must not be expanded into an unverified architecture.",
    "examples": {
      "bad": "My P2P layer uses Kademlia XOR routing and self-heals across thousands of nodes.",
      "good": "The protocol is built in Go with libp2p for peer-to-peer networking."
    }
  },
  {
    "id": "SR004",
    "name": "No AI Signature Phrases",
    "severity": "high",
    "category": "ai_patterns",
    "type": "static",
    "instruction": "Check for these AI signature phrases \u2014 flag if 3+ are present:\n\nOpening clich\u00e9s:\n  - 'In today's fast-paced world'\n  - 'In today's rapidly evolving landscape'\n  - 'In an era of'\n  - 'In the age of'\n  - 'It is important to note'\n  - 'It's worth noting that'\n  - 'It goes without saying'\n  - 'Needless to say'\n  - 'When it comes to'\n  - 'At its core'\n  - 'At the heart of'\n\nAI enthusiasm tells:\n  - 'Certainly!', 'Absolutely!', 'Great question!'\n  - 'Excited to share', 'Thrilled to announce'\n  - 'Delve into', 'Deep dive', 'Dive deep'\n\nGeneric transitions:\n  - 'In conclusion', 'To summarize', 'In summary'\n  - 'Furthermore', 'Moreover', 'Additionally'\n  - 'That being said', 'With that in mind'\n\nVIOLATED if 3 or more of these appear in the content.",
    "examples": {}
  },
  {
    "id": "SR005",
    "name": "No Corporate Buzzwords",
    "severity": "high",
    "category": "ai_patterns",
    "type": "static",
    "instruction": "Check for excessive use of these buzzwords \u2014 VIOLATED if 4+ present:\n  - Game-changing, Groundbreaking, Revolutionary, Transformative\n  - Disruptive, Unprecedented, Paradigm shift\n  - Synergy, Ecosystem, Leverage, Utilize\n  - Robust, Seamless, Holistic, Cutting-edge\n  - State-of-the-art, Best-in-class, World-class\n  - Unlock the power, Harness the power\n  - Navigate the complexities, Comprehensive overview\n",
    "examples": {}
  }
]

## Content:
"""
Foodiebay published restaurant menus. No ordering, no delivery, no logistics. In 2008 that was the whole product, and it worked because the problem was small enough to solve completely.

Then it became Zomato in 2010, and by 2015 delivery was the growth engine. That move changed what the company had to be good at. A directory carries no operational burden. A delivery marketplace inherits every failure point: prep times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food arrives on time and in condition," and that promise depends on partners the platform does not employ.

How Zomato responded is the part worth studying. It built around three coordinated networks: consumers, restaurant partners, delivery partners. Local density became the operating unit, because restaurant availability, demand and delivery capacity all vary by neighbourhood. Dispatch, partner onboarding, service quality and fraud controls moved in alongside search and checkout. Operations became part of the product surface, not a cost centre behind it.

The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners, across hundreds of Indian cities.

The corporate structure moved too. Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato, kept distinct from the entity as the portfolio widened.

The lesson for founders deciding what to build next: start with a problem small enough to solve completely, then earn the right to the adjacent one. Density before national scale. And when the portfolio widens, keep the consumer brand separate from the corporate one.

Which adjacent problem is your current product earning the right to solve?

#Startups #ProductStrategy #Operations #Founders #Scaling
"""

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{
  "violations": [
    {
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }
  ]
}

If nothing is violated, return {"violations": []}.
Return ONLY valid JSON

## RESPONSE

{"violations": []}

# static_validator

## SYSTEM

You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation.

## USER


Evaluate this content against the rules below.

## Format
This piece is a LinkedIn Post (150-300 words). Its conventions are intended; judge it as that format, not as an essay.

## Rules:
[
  {
    "id": "SR006",
    "name": "Grammar Correctness",
    "severity": "high",
    "category": "grammar",
    "type": "static",
    "instruction": "Check for:\n  - Subject-verb agreement errors\n  - Tense inconsistencies within sentences\n  - Article misuse (a/an/the)\n  - Dangling modifiers\n  - Run-on sentences (3+ clauses without proper punctuation)\n\nFlag specific grammatical errors with exact location.",
    "examples": {}
  },
  {
    "id": "SR007",
    "name": "Sentence Length Variety",
    "severity": "medium",
    "category": "readability",
    "type": "static",
    "instruction": "Check if the content has varied sentence lengths.\nFlag if:\n  - 5+ consecutive sentences are similar length (all long OR all short)\n  - Any single sentence exceeds 45 words\n  - All paragraphs follow identical length pattern\n\nHuman writing naturally mixes short punchy sentences with longer, more detailed ones.",
    "examples": {}
  },
  {
    "id": "SR008",
    "name": "Tense Consistency",
    "severity": "high",
    "category": "consistency",
    "type": "static",
    "instruction": "Check for unexpected tense shifts.\nFlag if the content switches between past/present/future\nwithout clear logical reason.\nNarrative tense should be stable throughout each section.",
    "examples": {}
  },
  {
    "id": "SR009",
    "name": "Terminology Consistency",
    "severity": "medium",
    "category": "consistency",
    "type": "static",
    "instruction": "Check if the same concept is referred to by multiple different names.\nE.g., switching between 'users', 'customers', 'clients', 'members'\nwithout clear purpose creates confusion.\nFlag inconsistent terminology for key concepts.",
    "examples": {}
  },
  {
    "id": "SR010",
    "name": "No Phrase Repetition",
    "severity": "medium",
    "category": "repetition",
    "type": "static",
    "instruction": "Check for:\n  - Same phrase used 3+ times\n  - Near-identical sentences in different parts\n  - Repeated opening words across consecutive paragraphs\n\nFlag specific repeated phrases with examples.",
    "examples": {}
  },
  {
    "id": "SR011",
    "name": "No Unnecessary Filler",
    "severity": "low",
    "category": "verbosity",
    "type": "static",
    "instruction": "Check for filler phrases that add length but no meaning:\n  - 'It is important to note that...'\n  - 'As we can see from the above...'\n  - 'In order to' (vs. just 'to')\n  - 'Due to the fact that' (vs. 'because')\n  - 'At this point in time' (vs. 'now')\n\nVIOLATED if 3+ filler phrases are present.",
    "examples": {}
  },
  {
    "id": "SR012",
    "name": "Logical Progression",
    "severity": "high",
    "category": "logical_flow",
    "type": "static",
    "instruction": "Evaluate the overall structure:\n  - Does the content have a clear opening that sets direction?\n  - Do ideas build on each other logically?\n  - Are there jarring topic jumps without transitions?\n  - Does the ending feel complete or abrupt?\n\nFlag specific logical gaps or disconnects.",
    "examples": {}
  }
]

## Content:
"""
Foodiebay published restaurant menus. No ordering, no delivery, no logistics. In 2008 that was the whole product, and it worked because the problem was small enough to solve completely.

Then it became Zomato in 2010, and by 2015 delivery was the growth engine. That move changed what the company had to be good at. A directory carries no operational burden. A delivery marketplace inherits every failure point: prep times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food arrives on time and in condition," and that promise depends on partners the platform does not employ.

How Zomato responded is the part worth studying. It built around three coordinated networks: consumers, restaurant partners, delivery partners. Local density became the operating unit, because restaurant availability, demand and delivery capacity all vary by neighbourhood. Dispatch, partner onboarding, service quality and fraud controls moved in alongside search and checkout. Operations became part of the product surface, not a cost centre behind it.

The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners, across hundreds of Indian cities.

The corporate structure moved too. Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato, kept distinct from the entity as the portfolio widened.

The lesson for founders deciding what to build next: start with a problem small enough to solve completely, then earn the right to the adjacent one. Density before national scale. And when the portfolio widens, keep the consumer brand separate from the corporate one.

Which adjacent problem is your current product earning the right to solve?

#Startups #ProductStrategy #Operations #Founders #Scaling
"""

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{
  "violations": [
    {
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }
  ]
}

If nothing is violated, return {"violations": []}.
Return ONLY valid JSON

## RESPONSE

{"violations": []}

# static_validator

## SYSTEM

You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation.

## USER


Evaluate this content against the rules below.

## Format
This piece is a LinkedIn Post (150-300 words). Its conventions are intended; judge it as that format, not as an essay.

## Rules:
[
  {
    "id": "SR013",
    "name": "Strong Opening",
    "severity": "medium",
    "category": "logical_flow",
    "type": "static",
    "instruction": "Evaluate only the FIRST sentence or paragraph:\n  - Starts with a clich\u00e9 ('In today's world...')? \u2192 VIOLATED\n  - Is it a vague generalization? \u2192 VIOLATED\n  - Makes a specific, interesting claim? \u2192 PASSED\n  - Poses a provocative question? \u2192 PASSED\n  - States a surprising or concrete fact? \u2192 PASSED\n",
    "examples": {}
  }
]

## Content:
"""
Foodiebay published restaurant menus. No ordering, no delivery, no logistics. In 2008 that was the whole product, and it worked because the problem was small enough to solve completely.

Then it became Zomato in 2010, and by 2015 delivery was the growth engine. That move changed what the company had to be good at. A directory carries no operational burden. A delivery marketplace inherits every failure point: prep times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food arrives on time and in condition," and that promise depends on partners the platform does not employ.

How Zomato responded is the part worth studying. It built around three coordinated networks: consumers, restaurant partners, delivery partners. Local density became the operating unit, because restaurant availability, demand and delivery capacity all vary by neighbourhood. Dispatch, partner onboarding, service quality and fraud controls moved in alongside search and checkout. Operations became part of the product surface, not a cost centre behind it.

The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners, across hundreds of Indian cities.

The corporate structure moved too. Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato, kept distinct from the entity as the portfolio widened.

The lesson for founders deciding what to build next: start with a problem small enough to solve completely, then earn the right to the adjacent one. Density before national scale. And when the portfolio widens, keep the consumer brand separate from the corporate one.

Which adjacent problem is your current product earning the right to solve?

#Startups #ProductStrategy #Operations #Founders #Scaling
"""

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{
  "violations": [
    {
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }
  ]
}

If nothing is violated, return {"violations": []}.
Return ONLY valid JSON

## RESPONSE

{"violations": []}

# static_validator

## SYSTEM

You are a meticulous but fair content auditor.

For each rule you are given:
1. Read the instruction.
2. Read the whole content with that one rule in mind.
3. Decide whether it is VIOLATED. A rule is violated only if you can quote the exact sentence that breaks it. If you cannot quote one, the rule passed.

Judge the piece as the format it is. Hashtag blocks, tweet separators (---), headings, bullet lists, SUBJECT lines, numbered tweets and [stage directions] are intended conventions of their formats and are never violations. A short piece cannot be faulted for sentence variety or repetition it has no room to show.

Do not be harsh for the sake of it. Style rules are a matter of degree: flag a clear breach, not a matter of taste.

Return ONLY valid JSON. No markdown, no explanation.

## USER


⚠️  PRIORITY: DYNAMIC BRAND RULES

Evaluate this content against the rules below.

## Format
This piece is a LinkedIn Post (150-300 words). Its conventions are intended; judge it as that format, not as an essay.

## Rules:
[
  {
    "id": "DR5A37C4001",
    "name": "Use preferred partner terminology",
    "severity": "high",
    "category": "brand_voice",
    "type": "dynamic",
    "instruction": "Check that the article uses 'delivery partners' instead of 'delivery boys' or similar, and 'restaurant partners' instead of 'vendors' or 'restaurants' when referring to partners. Flag any occurrence of banned phrases: 'delivery boys', 'game-changing', 'disrupt', 'unbeatable'.",
    "examples": {
      "good": "Our delivery partners are the backbone of the operation.",
      "bad": "Delivery boys are the backbone of the operation."
    }
  },
  {
    "id": "DR5A37C4002",
    "name": "Conversational yet professional tone",
    "severity": "high",
    "category": "tone",
    "type": "dynamic",
    "instruction": "Assess the overall tone: it should be conversational (e.g., use of contractions, relatable anecdotes) but remain professional and insightful. Avoid slang, excessive humor, or informal abbreviations. The tone should reflect Zomato's marketing voice: witty and culturally aware, but clear and empathetic.",
    "examples": {
      "good": "Remember when ordering food meant calling a restaurant and hoping for the best? Those days feel like ancient history.",
      "bad": "OMG, remember when we had to call restaurants? LOL, so archaic!"
    }
  },
  {
    "id": "DR5A37C4003",
    "name": "Address founders and product teams",
    "severity": "high",
    "category": "target_audience",
    "type": "dynamic",
    "instruction": "Check that the article explicitly addresses founders and/or product teams, offering takeaways, lessons, or strategic advice relevant to building and scaling products. Look for phrases like 'founders can learn', 'product teams should consider', or direct advice. The content should not be generic; it must include at least one clear takeaway for this audience.",
    "examples": {
      "good": "For founders, the key lesson is to stay close to user behavior and iterate quickly.",
      "bad": "This is a story about food delivery."
    }
  },
  {
    "id": "DR5A37C4004",
    "name": "Invite discussion in CTA",
    "severity": "high",
    "category": "campaign_objective",
    "type": "dynamic",
    "instruction": "Verify that the article ends with a call-to-action that explicitly invites readers to share their thoughts, ask questions, or engage in discussion. The CTA should be phrased as an invitation, e.g., 'What are your thoughts?', 'Share your experiences in the comments.', or 'Join the conversation.'",
    "examples": {
      "good": "What lessons have you drawn from similar pivots? Share your thoughts in the comments below.",
      "bad": "Thanks for reading."
    }
  },
  {
    "id": "DR5A37C4005",
    "name": "Narrative with actionable insights",
    "severity": "medium",
    "category": "writing_style",
    "type": "dynamic",
    "instruction": "Check that the article follows a narrative arc: it should describe the transformation from menu directory to food delivery, and then explicitly draw out lessons or takeaways for founders. The narrative should be clear and chronological, and the insights should be directly linked to the story.",
    "examples": {
      "good": "From a simple menu directory to a household name in food delivery, Zomato's journey offers three key lessons for founders.",
      "bad": "Zomato started as a menu directory and now does food delivery. Founders should learn from it."
    }
  },
  {
    "id": "DR5A37C4006",
    "name": "Reference food-tech context",
    "severity": "medium",
    "category": "industry_specific",
    "type": "dynamic",
    "instruction": "Ensure the article includes at least one specific reference to the food-tech industry, such as mentioning restaurant digitization, logistics, user reviews, or market expansion. The reference should be accurate and relevant to Zomato's context.",
    "examples": {
      "good": "The shift to online ordering required building a robust logistics network and partnering with restaurants for digitized menus.",
      "bad": "The company grew by expanding its services."
    }
  },
  {
    "id": "DR5A37C4007",
    "name": "Mention Eternal Limited appropriately",
    "severity": "medium",
    "category": "user_preference",
    "type": "dynamic",
    "instruction": "Check that if the article refers to the parent company or corporate entity, it uses 'Eternal Limited' instead of 'Zomato' or other names. If the article does not mention the corporate entity, this rule is not applicable. Do not force the term if not needed.",
    "examples": {
      "good": "Eternal Limited, the parent company of Zomato, has been at the forefront of this evolution.",
      "bad": "Zomato, as a company, has been at the forefront of this evolution."
    }
  }
]

## Content:
"""
Foodiebay published restaurant menus. No ordering, no delivery, no logistics. In 2008 that was the whole product, and it worked because the problem was small enough to solve completely.

Then it became Zomato in 2010, and by 2015 delivery was the growth engine. That move changed what the company had to be good at. A directory carries no operational burden. A delivery marketplace inherits every failure point: prep times, courier supply, routing, weather, refunds, support. The promise shifts from "here is the menu" to "your food arrives on time and in condition," and that promise depends on partners the platform does not employ.

How Zomato responded is the part worth studying. It built around three coordinated networks: consumers, restaurant partners, delivery partners. Local density became the operating unit, because restaurant availability, demand and delivery capacity all vary by neighbourhood. Dispatch, partner onboarding, service quality and fraud controls moved in alongside search and checkout. Operations became part of the product surface, not a cost centre behind it.

The scale that followed is documented in FY2025–26 annual-report materials: 979 million food-delivery orders, 24.3 million average monthly transacting customers, 330,000 average monthly active restaurant partners, 552,000 average monthly active delivery partners, across hundreds of Indian cities.

The corporate structure moved too. Zomato Limited became Eternal Limited in March 2025, with Blinkit, District and Hyperpure as sibling businesses. The consumer brand stayed Zomato, kept distinct from the entity as the portfolio widened.

The lesson for founders deciding what to build next: start with a problem small enough to solve completely, then earn the right to the adjacent one. Density before national scale. And when the portfolio widens, keep the consumer brand separate from the corporate one.

Which adjacent problem is your current product earning the right to solve?

#Startups #ProductStrategy #Operations #Founders #Scaling
"""

## Required Response (ONLY this JSON):
List ONLY the rules that are violated. A rule you do not list has passed.
{
  "violations": [
    {
      "rule_id":               "SR000",
      "violation_description": "What exactly was violated, in one sentence",
      "location":              "The exact sentence, quoted",
      "suggestion":            "How to fix it, in one sentence"
    }
  ]
}

If nothing is violated, return {"violations": []}.
Return ONLY valid JSON

## RESPONSE

{"violations":[]}