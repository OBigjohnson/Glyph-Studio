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
generic design announcements. Educational posts also receive an original
Gemini-generated image saved privately in the studio's storage and previewed
before saving the post. If image quota or availability prevents generation,
captions remain reviewable and saveable with their image prompt for later use.
Each caption opens with a curiosity-led, truthful hook and ends with a
platform-appropriate call to action linking directly to the public contact page.
Instagram, TikTok, and YouTube drafts include an
editable Google Flow prompt for a vertical short-form video. Prompts guide Flow
to preserve supplied project artwork when used as a visual reference, or to
create relevant explanatory motion for educational posts. The workspace/project
data and Gemini key stay server-side; only generated drafts and a signed preview
URL are returned to the browser. GLYPH does not send portfolio images to Gemini.

Review and edit each caption, generated image, image description, and video
prompt before saving. Image generation uses the Gemini image model and may
consume additional API quota or incur charges.
Posts keep an optional reference to their portfolio project and a content type;
recent content history informs topic rotation. Copy captions and Flow prompts,
download a selected image, and open each platform to publish manually. This
remains a planning and handoff workflow: GLYPH does not connect social accounts,
transmit content to providers, schedule jobs, or publish posts. Review generated
facts and educational advice for accuracy before posting.

Configure the `GEMINI_API_KEY` Supabase Function secret and deploy the
`generate-social-content` Edge Function as described in `setup.md`. The
optional `GEMINI_MODEL` secret defaults to `gemini-3.5-flash-lite`; the
educational-post image model defaults to `gemini-3.1-flash-image` and can be
overridden with the optional `GEMINI_IMAGE_MODEL` secret. Text and image
generation may incur Google API charges and remain subject to your Google AI
plan, rate limits, and Supabase project limits. Never put the Gemini key in a
`VITE_*` variable, the mobile app, or source control.

## StoryBrand blog and newsletter

The public `/blog` page lists only published posts. The private Studio
**Blog & email** workspace lets the studio write blog titles, article bodies,
and newsletter subject lines and body copy directly. Blog cover images are
uploaded by the studio to a public storage bucket; publishing requires a cover
image. Additional JPG, PNG, or WebP images can be uploaded in the article
editor and inserted between paragraphs at the text cursor; add a short image
description for accessibility. Posts can be saved as drafts and published
manually. No AI-generated blog or newsletter copy, or scheduled blog drafts,
are used.

The public mailing-list form adds readers immediately without an email
confirmation step. Campaigns go to active subscribers and include an
unsubscribe link. Sending uses Resend from `hello@glyphstudio.cv`; Resend must
verify `glyphstudio.cv` and its DNS records before mail can be delivered. The
sender and provider credentials stay in Supabase Function secrets. Studio
sends are manual, require the studio owner's approval, and are limited to 100
recipients per campaign in this first version. Campaign emails include links
to the five latest published posts; each post contains consultation booking
and optional paid-document links. Resend acceptance is recorded separately
from final delivery/bounce status.

Published posts can offer the GLYPH consultation menu in NGN or USD and an
optional paid PDF with both prices set by the studio. Bachs checkout links
collect the buyer's email, and consultation checkouts also collect the
requested Africa/Lagos appointment time. Only a signed successful-payment
webhook issues a receipt, sends the consultation request to the studio contact
email, and unlocks a time-limited PDF download. Requests are visible in Studio
under **Blog & email**. The requested time is not a confirmed calendar booking;
the studio follows up with the buyer to confirm.

Every article page also offers direct sharing links for Facebook, LinkedIn, X,
and WhatsApp, as well as a copy-link action. These links open the selected
service; GLYPH does not publish on the studio's social accounts.

Apply the migrations and deploy the newsletter Edge Function as described in
[`setup.md`](./setup.md#storybrand-blog-and-newsletter). Configure
`RESEND_API_KEY`, `NEWSLETTER_FROM`, and `PUBLIC_APP_URL` before sending
campaigns. Joining the list does not send an email; subscribers can
unsubscribe using the link included with every campaign. No domain secret or
sending credential belongs in the frontend or a `VITE_*` variable.

A community needs its own moderation and access model. An inquiry assistant
must be constrained to studio-approved service/pricing information and hand
off uncertain or custom requests; neither is enabled.

Google Drive is supported as a manually attached project/deliverable URL; no
Drive API integration is required for the current workflow.
