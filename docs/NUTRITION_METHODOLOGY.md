# Ingredient, Allergen, and Nutrition Methodology

Status: Phase 0 technical methodology approved for implementation planning; legal/nutrition review remains open.  
Checked: 2026-09-19

## Principles

- User-confirmed ingredients, not raw AI output, drive recipe matching and nutrition.
- Preserve source, method, version, serving basis, and unknowns.
- Never infer medical safety or turn missing data into zero.
- Provider nutrition is preferred when reliable and licensed; USDA FoodData Central is the fallback.
- Allergen evaluation is deterministic and jurisdiction-aware.

## Ingredient taxonomy

Use a versioned KitchenCam canonical taxonomy independent of AI and recipe providers.

Each ingredient has a stable UUID, canonical English name, food group, optional parent, edible form, default base unit, density/portion references, allergen relationships, and lifecycle state. Model distinctions only when they affect matching, allergens, cooking, or nutrition. For example, `milk` has children such as `cow milk` and `almond milk`; `red onion` may roll up to `onion` for matching.

Do not make preparation state a synonym. Store normalized facets such as `raw`, `cooked`, `frozen`, `dried`, `drained`, `peeled`, `chopped`, and `oil-packed`. Preserve the user's original display text.

## Aliases and normalization

Aliases contain normalized text, canonical ingredient ID, English locale/region, source, confidence class, and taxonomy version. Normalize Unicode, case, punctuation, singular/plural, and common abbreviations without discarding meaningful qualifiers. Brand names and ambiguous terms require separate rules.

Resolution order is exact canonical name, curated alias, provider mapping, then reviewed fuzzy candidate. Fuzzy matching never silently commits an ambiguous allergen-bearing ingredient; it returns `unmapped` or `needs_confirmation`.

## Units and quantities

Canonical storage uses decimal values and UCUM-inspired unit codes:

- mass base: gram;
- volume base: milliliter;
- count: each, clove, slice, can, package, bunch, and other typed portions;
- recipe display may convert to familiar US/metric units without changing the canonical value.

Mass-to-mass and volume-to-volume conversion is deterministic. Volume-to-mass conversion requires an ingredient-specific density with source/version. Count-to-mass requires a sourced portion record and size qualifier. Otherwise quantity remains unknown. Ranges preserve minimum/maximum; `to taste`, `as needed`, and garnish are non-numeric qualifiers.

## USDA FoodData Central mapping

Maintain a versioned `ingredient_food_mappings` table containing canonical ingredient, FDC ID, data type, preparation facets, mapping class, edible-portion factor, source release, reviewer, and validity dates.

Mapping preference:

1. Foundation Foods for well-characterized generic foods.
2. SR Legacy where Foundation coverage is absent and the legacy item is appropriate.
3. FNDDS for prepared/common consumed forms.
4. Branded Foods only for an exact product/brand match, never as a generic substitute.

Mapping classes are `exact`, `close`, `ambiguous`, and `unmapped`. Only exact/approved-close mappings participate automatically. Ambiguous and unmapped ingredients make affected nutrition incomplete. Cache normalized FDC records server-side with FDC ID, source release, fetched time, nutrient identifiers/units, and raw provenance. The API key remains server-side.

## Allergen representation

Use canonical allergen groups that can map to jurisdictional presentation sets. The initial ontology covers the US nine and the UK/EU fourteen, including milk, egg, fish, crustacean shellfish, molluscs, tree nuts by species, peanut, wheat/gluten cereals, soy, sesame, celery, mustard, lupin, and sulphites at applicable thresholds.

Ingredient-to-allergen relationships are versioned as:

- `contains`;
- `derived_from`;
- `may_contain` when supplied by a reliable source;
- `not_applicable` only when explicitly established;
- `unknown`.

Recipe evaluation outputs `contains`, `may_contain`, `not_identified`, or `unknown` for each relevant allergen. `Not identified` means no mapped ingredient declares it; it is not a medical-safe claim. If any ingredient, compound term, provider field, or cross-contact status is unresolved, the affected allergen is `unknown`. AI never resolves allergen state.

## Nutrition calculation

For every ingredient with a supported mass, multiply nutrient-per-100g values by edible grams. Sum without premature rounding. Adjust only with documented yield or retention factors; otherwise label the result as an ingredient-based estimate. Divide by a positive, explicit recipe yield to produce per-serving values.

Each nutrient carries value, unit, source, calculation state (`provider_reported`, `usda_calculated`, `mixed`, or `missing`), and completeness. Missing is not zero. Display a nutrition panel only with serving basis and source. Show partial values when useful, with an explicit incomplete state and a list/count of unmapped ingredients.

## Nutrition snapshots

Create immutable snapshots when provider content/version, ingredient mapping, yield, or calculation methodology changes. A snapshot stores:

- recipe/provider/content version;
- taxonomy and methodology versions;
- source FDC IDs/releases or provider nutrition version;
- normalized ingredient quantities and mapping classes;
- yield/serving basis;
- nutrient values and units;
- completeness ratio and missing reasons;
- calculated timestamp.

Favorites/history point to the recipe version and nutrition snapshot shown at the time where licensing permits. Recalculation creates a new snapshot, never silently rewrites historical provenance.

## Quality gates

- Golden tests for unit conversion, density, ranges, yields, and rounding.
- Reviewed fixtures for at least 200 common ingredients and all allergen groups.
- No recipe receives an allergen-clear state when any relevant input is unknown.
- Provider and USDA values are compared for material discrepancies and never blended without provenance.
- Nutrition UI is tested with missing serving count, partial nutrients, zero values, and unmapped ingredients.
- A qualified nutrition/legal reviewer must approve final language and jurisdiction mappings before production.

## Sources

- USDA FoodData Central API/licensing/rate limits: https://fdc.nal.usda.gov/api-guide/
- USDA downloadable releases: https://fdc.nal.usda.gov/download-datasets/
- FDA major food allergens: https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies
- UK Food Standards Agency 14 allergens: https://www.food.gov.uk/sites/default/files/media/document/14-Allergens%2016Nov21.pdf

All sources checked 2026-09-19. Exact launch-market presentation rules remain subject to legal/nutrition review.
