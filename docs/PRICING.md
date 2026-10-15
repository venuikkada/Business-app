# Plans & pricing

> These prices are **starting hypotheses**, not validated prices. Test them with real
> customers (see [GO_TO_MARKET.md](GO_TO_MARKET.md)) and change them in the admin panel.

Seed values: `packages/core/src/plans.ts`. **Live values:** the `plans` table, edited
in **Admin → Plans** (prices, trial days, limits and features). Changes apply
immediately to every business on that plan; all edits are recorded in the platform audit log.

| | Free | Starter | Pro | Business |
| --- | --- | --- | --- | --- |
| Monthly (₹, excl. GST) | 0 | 299 | 699 | 1,499 |
| Yearly (₹) | 0 | 2,990 | 6,990 | 14,990 |
| Free trial | — | 14 days | 14 days | 14 days |
| Invoices / month | 30 | 500 | 3,000 | Unlimited |
| Quotations / month | 30 | 500 | 3,000 | Unlimited |
| Products | 100 | 2,000 | 20,000 | Unlimited |
| Customers & suppliers | 200 | 5,000 | 50,000 | Unlimited |
| Users (incl. owner) | 1 | 1 | 5 | 25 |
| Branches | 1 | 1 | 1 | 10 |
| PDF invoices & quotations | ✓ | ✓ | ✓ | ✓ |
| Inventory & stock valuation | | ✓ | ✓ | ✓ |
| Expenses & cashbook | | ✓ | ✓ | ✓ |
| Payment / follow-up reminders | | ✓ | ✓ | ✓ |
| Purchases & supplier payments | | | ✓ | ✓ |
| Service tickets & AMC | | | ✓ | ✓ |
| Employee logins & roles | | | ✓ | ✓ |
| Advanced reports | | | ✓ | ✓ |
| Multiple branches & transfers | | | | ✓ |
| Custom roles | | | | ✓ |
| Priority support | | | | ✓ |
| Full data export | ✓ | ✓ | ✓ | ✓ |

## How it is enforced

- New businesses start a **14-day Pro trial** (`TRIAL_PLAN_CODE`). When a trial or paid
  period ends without payment, the business falls back to **Free** limits — nothing is
  deleted; over-limit data stays readable, only new creates are blocked.
- Limits and features are checked **on the server** for every create (with an advisory
  lock so two parallel requests can't both slip past a limit). Hiding a button is
  never the control.
- Data export is available on every plan: customers must always be able to take their data.
- Super admins can override a business's plan (e.g. for a pilot customer) with a
  reason; the override is audited.
- Payment: Razorpay order → Checkout → server verifies signature **and** fetches the
  payment from Razorpay before activating. Webhooks are verified and de-duplicated.
- GST on the subscription itself (18% SaaS) must be added to your invoices to
  customers once you are GST-registered; the checkout amount is the plan price as set.
  Decide whether prices are shown inclusive or exclusive of GST and make the pricing
  page say so.

## Pricing experiments to run

1. Yearly plan with "2 months free" (already ~17% cheaper) — push it at month 2.
2. A ₹149 "Billing only" plan between Free and Starter, if many Free users stall at 30 invoices.
3. Per-extra-user add-on (₹99/user) on Pro instead of jumping straight to Business.
4. Founding-customer price lock (first 100 paying shops keep their price for life).
