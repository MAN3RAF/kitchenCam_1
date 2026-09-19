# AI Ingredient Recognition Benchmark Plan

Status: Phase 0 benchmark design complete; empirical execution remains pending.  
Checked: 2026-09-19

## Decision boundary

This benchmark selects evidence, not a preferred vendor in advance. Candidate models must be server-callable, accept images, produce constrained structured output, and permit commercial use under acceptable data-processing terms. Start with one cost-oriented and one quality-oriented model from at least two providers. Current candidates for the first pilot are OpenAI GPT-5.6 Luna/Terra, Gemini Flash-family models, and Claude Haiku 4.5/Sonnet 5. Pin exact model versions during a run.

AWS Rekognition DetectLabels may be included as a non-generative baseline, but its general object-label API should not be assumed to provide KitchenCam-level ingredient granularity.

## Evaluation set

Build an 800-image, consented or properly licensed core set. Keep originals outside analytics, remove EXIF/GPS, and assign opaque test IDs. Two annotators label each image and a third adjudicates disagreements. Never use production user photos without specific research consent.

| Primary category | Images | Coverage |
|---|---:|---|
| Single raw ingredient | 120 | Whole, cut, peeled, fresh, frozen |
| Mixed countertop ingredients | 180 | 2-15 objects, overlap, containers, varied scale |
| Refrigerator, pantry, and cupboard | 140 | Clutter, shelves, transparent/opaque packaging |
| Packaged food | 100 | Visible/hidden label, glare, generic versus branded identity |
| Prepared or partially prepared food | 100 | Chopped mixtures, sauces, leftovers, composite ambiguity |
| Herbs, spices, and near-neighbors | 80 | Similar leaves, powders, onions, roots, peppers |
| Negative and unsupported | 80 | Empty scene, cookware, non-food, screenshot, unsafe/irrelevant content |

Apply cross-cutting tags for low light, blur, glare, occlusion, small objects, unusual angle, distant objects, skin/hands, culturally varied ingredients, spoiled appearance, reflections, multiple instances, and ambiguous granularity. Reserve 20% as a hidden holdout and maintain a smaller 100-image safety regression set.

## Ground truth

Each visible ingredient annotation contains:

- canonical taxonomy ID and acceptable parent/child IDs;
- display name and allowed aliases;
- visibility: `clear`, `partial`, or `ambiguous`;
- importance: `core`, `minor`, or `incidental`;
- count or quantity only when visually supportable;
- allergen-bearing sentinel tag for evaluation only;
- explicit acceptable abstention where a human cannot identify it reliably.

Ground truth does not infer hidden package contents or ingredients inside an opaque/composite dish. Prepared dishes can be labeled at dish level while internal ingredients remain unknown.

## Required structured output

```json
{
  "schemaVersion": "1",
  "imageAssessment": "food_detected | no_food | unusable",
  "items": [
    {
      "rawLabel": "string",
      "canonicalCandidateId": "string | null",
      "displayName": "string",
      "certainty": "likely | uncertain",
      "quantity": { "value": 2, "unit": "count" },
      "evidence": "short visual basis"
    }
  ],
  "warnings": ["string"]
}
```

Quantity is optional and must be omitted rather than guessed. The provider adapter validates JSON against one versioned schema, rejects extra fields, and maps provider-specific safety/refusal outcomes to typed KitchenCam errors.

## Metrics

Measure exact and hierarchical set matching after deterministic alias normalization:

- micro and macro precision, recall, and F1;
- per-category and per-challenge-tag metrics;
- false positives per image and false negatives per visible ground-truth item;
- core-ingredient recall and allergen-sentinel recall;
- non-food rejection and unusable-image detection;
- canonical exact-match rate, acceptable-parent match rate, and unmapped rate;
- duplicate-collapse and quantity/unit validity;
- schema-valid response rate and refusal/error rate.

Do not score a reasonable parent such as `onion` as fully wrong when the ground truth is `red onion`; report exact and hierarchy-aware results separately. Never translate model confidence into a fake probability.

For uncertainty, report selective precision and coverage: precision among `likely` items, error concentration among `uncertain` items, and abstention rate. A useful label separates risk; it need not numerically calibrate a hidden model score.

## Latency and cost

Run from the intended Supabase region with warm and cold samples separated. Record client-independent queue wait, storage read, provider time-to-first-byte, provider completion, validation/normalization, and total job time. Report p50, p90, p95, p99, timeout rate, and retry rate by image size and model.

Record billed image/input tokens, output tokens, request charges, retries, and currency for every call. Calculate:

`cost per successful scan = all provider charges, including failed/retried calls / completed scans`

Also report cost per attempted scan and cost by category. Use actual invoices to reconcile instrumentation.

## Execution protocol

1. Freeze prompt, schema, preprocessing, taxonomy, provider region, and model version.
2. Run a 200-image pilot once per candidate to remove clearly unsuitable models.
3. Run finalists twice over the full set in randomized order; run the nondeterminism subset five times.
4. Tune only on the development split, then run the hidden holdout once.
5. Have blinded reviewers inspect every false negative, every hallucinated `likely` item, and all safety-sentinel failures.
6. Publish a signed benchmark report containing raw aggregate metrics, model/version, pricing date, and known limitations.

## Provisional acceptance gates

These are engineering gates to validate, not product guarantees:

- at least 99.5% schema-valid responses after one bounded repair attempt;
- overall precision at least 0.90 and recall at least 0.85;
- core visible-ingredient recall at least 0.92;
- `likely` precision at least 0.95;
- no model-produced safety or medical claim;
- non-food/unusable rejection at least 0.98;
- p95 provider latency at most 12 seconds and p95 total job latency at most 20 seconds under benchmark load;
- provider-error rate below 1% excluding deliberate fault injection;
- median variable AI cost at most $0.03 and p95 at most $0.08 per completed scan;
- no material quality regression across representative skin tones, kitchen styles, or cultural ingredient groups.

If no candidate passes, do not select one. Adjust capture guidance, narrow supported scenarios, improve taxonomy/preprocessing, or defer the feature.

## Sources

- OpenAI models and current token prices: https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Claude model comparison: https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-5
- Claude vision token/cost guidance: https://platform.claude.com/docs/en/build-with-claude/vision
- AWS Rekognition DetectLabels: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectLabels.html

All sources checked 2026-09-19. Recheck model availability, data terms, and prices immediately before running the benchmark.
