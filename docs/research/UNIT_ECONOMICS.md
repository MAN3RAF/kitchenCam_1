# KitchenCam Unit Economics Model

Status: Phase 0 planning model; assumptions are not pricing or quota decisions.  
Currency: USD. Checked: 2026-09-19.

## Model

Separate fixed platform cost, variable scan/session cost, and subscription transaction cost.

`monthly free-user cost = allocated platform cost + scans * variable scan cost - ad contribution`

`monthly premium contribution = net subscription revenue - allocated platform cost - scans * variable scan cost`

The variable scan envelope includes AI inference and retries, one recipe-search session, short-lived image storage/egress, Edge Function work, analytics, and monitoring. Recipe license minimums, staff, moderation, support, tax, refunds, legal work, and marketing remain outside contribution margin until quoted.

## Source-backed inputs

| Item | Current public basis | Modeling treatment |
|---|---|---|
| Supabase | Pro $25/month; 100 GB storage, 250 GB uncached egress, 2m function calls included; overages include $0.021/GB storage, $0.09/GB uncached egress, $2/million functions | Allocate fixed platform cost per MAU; marginal scan cost is small inside allowance |
| RevenueCat | Free through $2,500 monthly tracked revenue, then 1% of tracked revenue | Show both free-tier and 1% cases; conservative tables use 1% |
| Apple/Google stores | Model 15% subscription commission assuming eligibility/current subscription terms | Revalidate by storefront and developer program |
| PostHog | 1m analytics events/month free, then usage pricing | Strict allowlist; model small per-scan amount beyond free tier |
| Sentry | Developer $0; Team $26/month with included events | Allocate fixed plan; no session replay |
| Recipe provider | Spoonacular public plans $29-$149 plus point overage; Edamam $9/$99/$399 tiers; FatSecret commercial quote | Use a variable allowance plus separate unknown license minimum |
| AdMob | Revenue is measured as impressions times observed eCPM; Google publishes no guaranteed KitchenCam eCPM | Use scenarios only, never count ads as guaranteed funding |

## Cost assumptions

| Scenario | AI/provider inference | Recipe session | Infra, storage, telemetry | Variable cost per completed scan | Allocated monthly platform cost/MAU |
|---|---:|---:|---:|---:|---:|
| Efficient | $0.003 | $0.005 | $0.002 | $0.010 | $0.03 |
| Base | $0.015 | $0.015 | $0.005 | $0.035 | $0.08 |
| Stress | $0.050 | $0.040 | $0.010 | $0.100 | $0.20 |

These are deliberately broad placeholders. The AI benchmark must replace inference assumptions with invoice-reconciled cost. Provider contract quotes must replace recipe assumptions. Failed KitchenCam/provider scans restore user quota but their cost still belongs in the numerator.

## User scenarios

| Scenario | Free scans/MAU | Gross free cost | Assumed ad contribution | Net free cost | Premium scans/MAU | Premium service cost |
|---|---:|---:|---:|---:|---:|---:|
| Efficient/light | 3 | $0.06 | $0.02 | $0.04 | 10 | $0.13 |
| Base/engaged | 8 | $0.36 | $0.08 | $0.28 | 30 | $1.13 |
| Stress/heavy | 20 | $2.20 | $0.20 | $2.00 | 80 | $8.20 |

Ad assumptions correspond to illustrative monthly impressions and realized eCPM, not a forecast. Measure Ads ARPU by country, consent status, platform, and placement during a limited beta. Premium users make zero ad requests.

## Subscription hypotheses

Assuming a 15% store commission and RevenueCat at 1% of gross tracked revenue:

| Product | Gross monthly equivalent | After store | RevenueCat allowance | Net before service cost |
|---|---:|---:|---:|---:|
| $9.99 monthly | $9.99 | $8.49 | $0.10 | $8.39 |
| $79.99 annual | $6.67 | $5.67 | $0.07 | $5.60 |

| Usage scenario | Monthly-plan contribution | Annual-plan monthly contribution |
|---|---:|---:|
| Efficient/light | $8.26 | $5.47 |
| Base/engaged | $7.26 | $4.47 |
| Stress/heavy | $0.19 | -$2.60 |

The annual hypothesis discounts monthly-equivalent gross revenue by about 33%. It remains viable in the base variable-cost scenario, but has much less room for recipe-license minimums, tax, refunds, support, and heavy usage. This is a concrete reason not to promise unlimited scans.

## Provisional quota envelope

For beta planning only, test:

- Free: 3-5 successful scans per rolling month.
- Premium: 30-50 successful scans per rolling month, plus a server-side daily abuse cap.

This is a proposal, not a final decision. Recompute after the AI benchmark, recipe quotes, beta scan distribution, paid conversion, retention, Ads ARPU, refunds, and country mix. Quota reservations are atomic and automatically released for KitchenCam/provider failures.

## Sensitivity and break-even checks

- At $0.035 per scan, 50 Premium scans cost about $1.75 plus allocated platform cost.
- At $0.10 per scan, 50 scans cost about $5.00 plus allocated platform cost; annual margin becomes thin.
- Every $100/month fixed recipe license costs $0.10 per MAU at 1,000 MAU but $1.00 per MAU at 100 MAU.
- Ads should offset some free-user cost, not justify higher quota until country-specific revenue is observed.
- RevenueCat's fee is zero below its published threshold, improving early margins by roughly $0.10/monthly subscriber and $0.07/annual subscriber per month versus this conservative table.

## Instrumentation required before final approval

Record successful/failed scans, billed AI units, provider calls/points, image bytes and lifetime, egress, queue retries, recipe detail opens, ad impressions/revenue, storefront net proceeds, refunds, entitlement days, and MAU. Aggregate financial telemetry server-side without photos, ingredient lists, allergies, receipts, tokens, or free text.

## Sources

- Supabase billing: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Supabase function usage: https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations
- RevenueCat pricing: https://www.revenuecat.com/pricing/
- Apple Small Business Program: https://developer.apple.com/app-store/small-business-program/
- Google Play service fees: https://support.google.com/googleplay/android-developer/answer/112622
- PostHog pricing: https://posthog.com/pricing
- Sentry pricing: https://sentry.io/pricing/
- AdMob eCPM definition: https://support.google.com/admob/answer/7356428

All sources checked 2026-09-19; revalidate before budget or pricing approval.
