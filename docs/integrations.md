# GLYPH integrations roadmap

Bachs checkout is implemented behind Supabase Edge Functions and becomes
available after the deployment steps in `setup.md` are completed. The studio
must create and verify its own Bachs merchant account, set the merchant name
and payout destination in Bachs, and use that account's production credentials.
GLYPH does not create Bachs accounts or set their legal/merchant identity.
Other external integrations are not connected. Do not show an account as
connected, send email, publish content, or report automation success until a
trusted server has verified the provider response. `service_role` keys, OAuth
tokens, and provider secrets must never be placed in `VITE_*` variables.

## Bachs invoice payments

The studio can share a public checkout link for each invoice. The client
chooses a 25%, 50%, 75%, or remaining-balance payment and is redirected to
Bachs-hosted checkout for the server-calculated amount. Supabase Edge
Functions create the checkout and accept only signed `collection.succeeded`
webhooks that match its stored amount and currency. Checkout uses the invoice
currency, and sandbox/live reservations are isolated. Verified payments
produce receipts for the studio and payer and update the invoice; redirects
alone do not mark an invoice as paid. Receipt copies are available in GLYPH but
are not emailed. Manual verified bank transfers remain supported.

## Gemini social content calendar

The workspace-private social calendar supports Instagram, TikTok, Facebook, X,
LinkedIn, and YouTube. Choose enabled platforms in Studio settings. When
generating content, the authenticated Supabase Edge Function reads the studio's
portfolio project descriptions and recent post usage, then Gemini balances
educational solution posts with portfolio stories so the calendar is not limited
to showcasing work. Educational posts provide actionable advice; portfolio
stories connect a real audience need to a relevant project/service. Captions
are distinct and platform-native, with natural sales invitations rather than
generic design announcements. Instagram, TikTok, and YouTube drafts include an
editable Google Flow prompt for a vertical short-form video. Prompts guide Flow
to preserve supplied project artwork when used as a visual reference, or to
create relevant explanatory motion for educational posts. The workspace/project
data and Gemini key stay server-side; only generated drafts are returned to the
browser. GLYPH does not send portfolio images to Gemini.

Review and edit each caption, image description, and video prompt before saving.
Posts keep an optional reference to their portfolio project and a content type;
recent content history informs topic rotation. Copy captions and Flow prompts,
download a selected image, and open each platform to publish manually. This
remains a planning and handoff workflow: GLYPH does not connect social accounts,
transmit content to providers, schedule jobs, or publish posts. Review generated
facts and educational advice for accuracy before posting.

Configure the `GEMINI_API_KEY` Supabase Function secret and deploy the
`generate-social-content` Edge Function as described in `setup.md`. The
optional `GEMINI_MODEL` secret defaults to `gemini-3.5-flash-lite`. Gemini usage
may incur Google API charges and remains subject to your Google AI plan, rate
limits, and Supabase project limits. Never put the Gemini key in a `VITE_*`
variable, the mobile app, or source control.

## Future email, community, and assistant

Custom outbound email requires a verified sending domain, server-side provider
credentials, bounce handling, and user consent. A community needs its own
moderation and access model. An offline inquiry assistant must be constrained
to studio-approved service/pricing information and hand off uncertain or
custom requests; none of these services is currently enabled.

Google Drive is supported as a manually attached project/deliverable URL; no
Drive API integration is required for the current workflow.
