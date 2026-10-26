# Bachs checkout and invoice payments

GLYPH supports hosted Bachs checkout alongside the existing verified manual
bank-transfer flow. Invoice amounts and currencies come from Supabase, not the
browser. A client can pay 25%, 50%, 75%, or the remaining balance; each option
is capped at the amount still due. Payments are recorded only after the server
verifies a signed Bachs `collection.succeeded` webhook and checks the paid
amount and currency against the checkout session. Checkout is pinned to the
invoice currency so Bachs currency conversion cannot cause a valid payment to
be mistaken for a mismatched amount.

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

The app creates both receipt views in GLYPH; it does not email receipts or
send messages on the studio's behalf. Share the checkout URL before payment
and the same URL remains the client's receipt page afterward.

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
- The Bachs webhook destination URL includes Supabase's browser-safe
  publishable/anon key as an `apikey` query parameter for gateway access.
  Webhook authenticity is still established only by the Bachs signature;
  never put a `service_role` key in that URL.
- Checkout reservations are tied to a single invoice and expected amount.
  Public invoice links are random UUID capabilities; never publish them for
  invoices that should remain private.
- Never put Bachs API keys, webhook secrets, Supabase `service_role` keys, or
  checkout credentials in `VITE_*` variables, browser code, or source control.

See [setup.md](./setup.md) for database migration, Edge Function, secret, and
Bachs webhook setup.
