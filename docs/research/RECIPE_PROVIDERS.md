# Recipe Provider Research

Status: Phase 0 public-source review complete; contract and sample-data diligence remain blocked.  
Checked: 2026-09-19

## KitchenCam requirements

The MVP needs commercial mobile-app rights to search by confirmed ingredients and filters, display full ingredient lists and cooking instructions in-app, show licensed images, provide provenance, and retain stable identifiers for favorites/history. Nutrition and allergen fields must expose unknowns. Tutorial video is optional. Offline rights are not required for MVP, but caching terms must support reliable in-app use.

## Comparison

| Approach | Instructions/images/video | Attribution | Caching and offline | Limits and public price | Assessment |
|---|---|---|---|---|---|
| Edamam web recipes | Images/ingredients; web catalog omits instructions and links to source. No dependable video promise. | Edamam and source attribution required | Caching generally prohibited except narrow fields on eligible plans; no offline right | Public plans show $9/10k calls, $99/500k, $399/1m; rights vary | Low-cost web catalog does not meet in-app instruction requirement |
| Edamam owned/licensed catalog | Owned content and separately licensed publisher catalog advertise full instructions, images, nutrition, and allergen labels | Contract-specific, Edamam attribution normally required | Publisher licensing can support local retention, but exact rights and removal obligations require a quote | Owned-content plan shown at $399/month; publisher licensing is quote-based | Strong diligence candidate, but catalog includes some AI-created content that must be excluded for this MVP |
| Spoonacular | Instructions when available, images, nutrition; no reliable video entitlement | Original recipe source must be credited | Most data cannot be stored; permitted cache is at most one hour with prior permission. Only ID/title/image URL may be retained indefinitely | Free 50 points/day; $29/1,500 points/day; $79/4,500; $149/10,000, then overage | Functional prototype candidate, but default terms conflict with robust caching and create content/provenance risk |
| FatSecret Premier | Advertises 19k+ curated recipes with directions, ingredients, images, nutrition; video not advertised | Required on Basic/Premier Free; paid Premier can be white-label | Caching is a Premier feature, but default terms require most non-storable content to refresh/remove within 24 hours; offline rights unclear | Basic 5k calls/day; qualifying startup Premier Free; business pricing by market is quote-only | Strong API/catalog candidate if contract confirms recipe, cache, removal, and market rights |
| TheMealDB paid supporter | Full meal payloads and images; some records may link video | Source mention/link expected | Terms permit copying/modification of API-returned content, but third-party content permission remains the user's responsibility | Public production requires paid supporter tier; API says unlimited, price shown through Patreon rather than a clear SLA contract | Useful seed/prototype source, but provenance, completeness, SLA, and commercial indemnity are not strong enough for launch without audit |
| Owned/licensed catalog | Exactly the fields and quality KitchenCam contracts for; video can be licensed separately | Controlled per contract | Can negotiate server storage and later offline rights | Highest up-front editorial/licensing cost; price unknown | Best control and portability, but operationally expensive |

## Findings

No provider clearly satisfies all KitchenCam requirements from public self-serve terms alone.

- Edamam's separately licensed publisher catalog is the clearest public statement of full-content rights, but requires sales/legal diligence and must exclude AI-generated recipes.
- FatSecret Premier appears operationally attractive and supports market-specific data, but pricing and durable content rights are not public enough to approve.
- Spoonacular has useful ingredient-search endpoints and transparent pricing, but its storage restrictions are a poor fit for favorites, history, resilient detail views, and any later offline capability.
- TheMealDB's permissive wording does not eliminate third-party copyright/provenance risk and lacks the commercial assurances expected for a production catalog.

## Required provider diligence

Request written answers and a sample contract from Edamam licensed content and FatSecret Premier first; keep Spoonacular as a benchmark comparator. Ask each candidate:

1. Are instructions, ingredient lines, images, nutrition, allergen flags, and source metadata licensed for commercial iOS/Android display?
2. May KitchenCam cache each field, for how long, and retain immutable snapshots for favorites/history after cancellation?
3. Are derived normalized ingredients, search indexes, embeddings, and nutrition calculations considered stored provider content?
4. Are offline copies, screenshots, and device caches permitted now or under a later addendum?
5. Which countries, languages, and app-store territories are covered?
6. Are publisher takedowns/version changes delivered, and what deletion SLA applies?
7. What attribution is required on result cards, detail, nutrition, and images?
8. Is video included and are captions/transcripts licensed?
9. What SLA, rate limits, burst behavior, overages, audit rights, indemnities, and termination/export terms apply?
10. Can all AI-authored recipes be excluded contractually and technically?

## Vendor-neutral contract

`RecipeProvider` should expose provider-neutral search, detail, nutrition provenance, rights metadata, and stable external references. Every response carries `providerId`, `providerRecipeId`, `contentVersion`, `attribution`, `rightsProfile`, `fetchedAt`, and per-field cache expiry. Provider DTOs never enter domain or UI code.

Search ranking remains owned by KitchenCam. The adapter must distinguish `unsupported_filter`, `rate_limited`, `content_removed`, `license_restricted`, `not_found`, and `provider_unavailable`. A rights policy decides whether a field may be cached, persisted to history, or shown offline.

## Recommendation

Do not approve a provider yet. Run contract/sample-data diligence on Edamam licensed publisher content and FatSecret Premier, and execute a 100-query relevance/coverage test only after evaluation access is legally available. Require a documented exit path and owned stable identifiers before Phase 2.

## Sources

- Edamam Recipe API plans/rights: https://developer.edamam.com/edamam-recipe-api
- Edamam Recipe API FAQ: https://developer.edamam.com/api/faq
- Edamam licensed recipe catalog: https://developer.edamam.com/recipe-database-licensing
- Spoonacular pricing/cache FAQ: https://spoonacular.com/food-api/pricing
- Spoonacular terms: https://spoonacular.com/food-api/terms
- Spoonacular API docs: https://spoonacular.com/food-api/docs
- FatSecret editions/pricing: https://platform.fatsecret.com/api-editions
- FatSecret platform/catalog: https://platform.fatsecret.com/platform-api
- FatSecret terms: https://platform.fatsecret.com/terms
- TheMealDB terms: https://www.themealdb.com/terms_of_use.php
- TheMealDB API guide: https://www.themealdb.com/docs_api_guide.php

All sources checked 2026-09-19. Public pages are not a substitute for signed commercial terms.
