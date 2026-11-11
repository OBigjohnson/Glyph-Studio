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
**Blog & email** workspace generates StoryBrand-guided blog and newsletter
drafts from the shared Glyph BrandScript. A Supabase Cron job can generate one
additional 700-1,200 word blog draft per day using the `generate-daily-blog`
function; its migration and scheduling setup are documented in `setup.md`.
Blog articles are checked against
the 700-1,200 word brief and include SEO fields, two alternate hooks, an SB7
angle, and a customer-as-hero visual direction. Review and publish posts
manually; daily generation never publishes automatically. The blog uses
curated Unsplash photographs as customer-focused cover images, which can be
selected for each post.

The public mailing-list form uses double opt-in. Only confirmed subscribers
receive campaigns, and each message includes an unsubscribe link. Sending uses
Resend from `hello@glyphstudio.cv`; Resend must verify `glyphstudio.cv` and its
DNS records before mail can be delivered. The sender and provider credentials
stay in Supabase Function secrets. Studio sends are manual, require
confirmation, and are limited to 100 recipients per campaign in this first
version. Resend acceptance is recorded separately from final delivery/bounce
status.

Apply the migration and deploy both Edge Functions as described in
[`setup.md`](./setup.md#storybrand-blog-and-newsletter). Configure
`RESEND_API_KEY`, `NEWSLETTER_FROM`, and `PUBLIC_APP_URL` before using signup
confirmation or sending. The Gemini `GEMINI_API_KEY` is also required for
editorial drafts. No API key, domain secret, or sending credential belongs in
the frontend or a `VITE_*` variable.

A community needs its own moderation and access model. An inquiry assistant
must be constrained to studio-approved service/pricing information and hand
off uncertain or custom requests; neither is enabled.

Google Drive is supported as a manually attached project/deliverable URL; no
Drive API integration is required for the current workflow.
