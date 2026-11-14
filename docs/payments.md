# Bachs checkout and invoice payments

GLYPH supports hosted Bachs checkout alongside the existing verified manual
bank-transfer flow. Invoice amounts and currencies come from Supabase, not the
browser. A client can pay 25%, 50%, or 75% of the original invoice, capped at
the amount still due, or pay 100% of the remaining balance. Payments are
recorded only after the server verifies a signed Bachs
`collection.succeeded` webhook and checks the paid amount and currency against
the checkout session. Checkout is pinned to the invoice currency so Bachs
currency conversion cannot cause a valid payment to be mistaken for a
mismatched amount.

To pass Bachs' payment-processing fee to the payer, set the Bachs account's
checkout `fee_preference` to `customer_pays`. Bachs adds its processing fee to
the amount the payer pays, so the studio settles the invoice amount before
processing fees. This is separate from Bachs withdrawal fees, which are still
charged when moving funds from the Bachs balance to a bank, wallet, or other
destination. GLYPH does not add a separate fixed NGN 100 surcharge.

## Studio workflow

1. In **Finance**, create an invoice. Newly created invoices receive a secure
   checkout link automatically.
2. Click **Copy checkout link** and send that URL to the client by your usual
   channel. The client does not need an account in GLYPH to open the link.
3. The client chooses a deposit or the remaining balance and continues to
   Bachs-hosted checkout. GLYPH never collects card or bank credentials.
4. After Bachs confirms payment, GLYPH records the payment, creates a unique
   receipt, updates the invoice balance/status, and adds the payment to income.
   Repeated webhook deliveries do not duplicate payments or receipts.
5. The studio can print a studio receipt or a separate client confirmation
   from **Finance → Receipts**. The client can print their receipt from the
   checkout link; a receipt shows the amount received, total paid so far, and
   remaining balance. Signed-in studio and client pages refresh payment
   records through Supabase Realtime.

Clients with a portal account can pay online from the invoice in their portal.
The existing bank-transfer option remains available: the studio verifies the
transfer and records only the amount actually received. Manual payments also
update the cumulative balance and cannot exceed it.

Invoice receipts are available in GLYPH but are not emailed; share the invoice
checkout URL before payment and it remains the client's receipt page afterward.
Paid blog consultations and documents use the separate editorial purchase flow:
after a verified webhook, GLYPH emails the buyer's receipt and consultation
requests to the studio contact email. See [setup.md](./setup.md#paid-blog-consultations-and-documents).

## Server-side boundaries

- `BACHS_API_KEY` is used only by the `bachs-checkout` Supabase Edge Function.
  `BACHS_MODE` must match the key: sandbox uses `https://sandbox-api.bachs.io`
  and live uses `https://api.bachs.io`. Each checkout reservation is tagged
  with its mode, so sandbox and live sessions cannot be reused across modes.
- `BACHS_WEBHOOK_SECRET` is used only by `bachs-webhook`. The function verifies
  the timestamped HMAC-SHA256 signature against the raw request body before
  it trusts an event. Only `collection.succeeded` can create a payment.
- `BACHS_ORGANIZATION_ID` must be the Bachs organization that owns the API key.
  The webhook rejects events from a different organization. The key owner is
  the merchant account that receives the payment; its verified business name
  and payout destination must be configured in Bachs, not in GLYPH.
- The Bachs account checkout setting `fee_preference` supports `customer_pays`
  and `org_pays`. Choose `customer_pays` in the Bachs account's checkout
  settings to pass its processing fee through; this does not cover withdrawal
  fees.
- The Bachs webhook destination URL includes Supabase's browser-safe
  publishable/anon key as an `apikey` query parameter for gateway access.
  Webhook authenticity is still established only by the Bachs signature;
  never put a `service_role` key in that URL.
- Checkout reservations are tied to a single invoice and expected amount.
  Public invoice links are random UUID capabilities; never publish them for
  invoices that should remain private.
- Editorial consultations and paid blog PDFs use a separate purchase record and
  the same signed Bachs webhook. A success redirect alone never marks one as
  paid; the webhook must match the checkout amount and currency before issuing
  a receipt, notifying the studio, or allowing a private PDF download.
  After confirmation, both purchase types are included in **Studio → Finance**
  income totals by currency, with receipt links stored alongside the invoice
  receipts. Paid consultation customer details and requested Africa/Lagos times,
  and paid PDF customer details, are also listed in **Studio → Blog & email**.
  The studio can open a pre-addressed email to each buyer with a GLYPH Studio
  signature; send it from the hello@glyphstudio.cv account.
- Never put Bachs API keys, webhook secrets, Supabase `service_role` keys, or
  checkout credentials in `VITE_*` variables, browser code, or source control.

See [setup.md](./setup.md) for database migration, Edge Function, secret, and
Bachs webhook setup.
