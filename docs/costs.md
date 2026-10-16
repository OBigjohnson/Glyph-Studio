# GLYPH Studio: cost and account requirements

Pricing checked 13 October 2026. USD amounts are provider-published prices, not
Nigeria-specific quotations. Taxes, NGN conversion, card fees, domain names,
and provider eligibility can change the final cost.

## Lowest-cost production path

| Area | Lowest-cost starting point | Price and important limits |
| --- | --- | --- |
| Public website hosting | Cloudflare Pages Free | $0/month for static hosting. Free limits include 500 builds/month, 20,000 files, and 25 MiB per file. Use its provided `pages.dev` address at no domain cost. A custom domain must be purchased separately. |
| App data and client portal | Existing Supabase Free project | $0/month within quotas: 1 GB Storage, 500 MB database, 50,000 monthly active users, and 5 GB each of cached and uncached bandwidth. Free projects can pause after seven days of inactivity. |
| Imported portfolio files | Keep files in the existing private Supabase bucket | The imported 169 files use about 328.5 MiB, leaving about 695.5 MiB of the Free storage allowance before other stored files. A complete download of all work is about 328.5 MiB; repeated downloads count toward bandwidth. Keep every file private until its portfolio story is explicitly published. |
| Custom web address | Optional domain registration | Not included in free hosting. Price depends on the chosen name, registrar, and top-level domain; renewals may differ from introductory prices. |
| Account and password emails | Resend Free over custom SMTP | $0 for up to 3,000 emails/month and 100/day. Requires a sending domain and DNS verification. Supabase's built-in email service is not a substitute for production SMTP: it is limited to 2 messages/hour and project-team recipients. |
| Payment checkout | KoraPay merchant account | Requires merchant verification. Confirm the current Nigerian fees for each payment method and settlement with KoraPay; the public developer pages do not establish a reliable current merchant fee or monthly cost. Expect provider transaction fees; do not budget an invented rate. |
| Public inquiry assistant | Begin with a no-AI approved FAQ, or use a metered model with a hard budget | An example using OpenAI GPT-5 nano pricing of $0.05/1M input tokens and $0.40/1M output tokens is about $0.17 for 1,000 inquiries at 1,000 input and 300 output tokens each. Actual usage varies. Gemini offers selected free quotas, but Google states free-tier data may be used to improve its products. Do not send confidential client/project data to a free public-model tier. |

### Portfolio hosting caveat

The existing importer accepts files up to 50 MB. Cloudflare Pages Free has a
25 MiB per-file limit. Of the 169 imported files, one file (`CPFN 2.png`) is
about 31 MiB and cannot be deployed as a Pages static asset without
optimization. Leave that asset in Supabase Storage or create an optimized
copy. Keeping the private Supabase Storage bucket is the simpler first launch
path, but storage and bandwidth quotas still apply.

## Social accounts and scheduled posts

The GLYPH calendar includes a built-in, deterministic writing-recipe generator
that prepares editable Instagram, Facebook Page, and X drafts from the selected
portfolio title, service, and summary. It is not generative AI and has no AI
API charge. Choose an existing portfolio image, review/edit the drafts, then
copy captions and download the image to schedule or publish manually in the
platform's own app. GLYPH does not automatically post. There is no new provider,
social API, OAuth, or scheduler charge. Supabase database/storage usage and
hosting quotas still apply; the image is referenced from the existing portfolio
bucket rather than duplicated.

Connecting GLYPH to these services has no published per-post API charge in the
referenced Meta and YouTube documentation. It still requires implementation,
OAuth consent, approved scopes, developer accounts, and—in some cases—app
reviews or audits:

| Platform | Account/access required | Scheduling and cost caveat |
| --- | --- | --- |
| Instagram | Professional (Business or Creator) account and Meta developer app | GLYPH must run its own scheduler; the documented publishing API does not provide a general future-time publish field. External clients/users can require Meta review and Business Verification. No API fee is listed. |
| Facebook | Facebook Page, Page access token, Meta developer app, `pages_manage_posts` permission | Page posts support scheduled publishing up to 30 days ahead. External users can require app review. No API fee is listed. |
| YouTube | Google developer project, YouTube Data API, channel authorization | `publishAt` supports scheduled publishing. Public uploads from an unverified API project are restricted until audit. No API fee is listed for the documented default quota. |
| X | X developer account, project/app, post-write access | The app must run the scheduler. Current pay-per-use pricing lists $0.015 per create-post request, or $0.20 per post with a URL. Credits for eligible accounts are not guaranteed. |
| TikTok | TikTok developer app, Content Posting API, user authorization, `video.publish` approval | GLYPH must run its own scheduler. Public posting requires TikTok audit; unaudited posting is private-only. The cited docs do not provide a public fixed per-post price. |

Media processing, worker execution, and storage must also fit within hosting
quotas. Begin with one studio account, manual approval before posting, and
scheduled jobs only after each network passes its own authorization and test.

## Inputs to prepare

- Cloudflare account; use the free `pages.dev` address initially, or choose a
  domain and provide its DNS access.
- Existing Supabase owner access, and review of Storage/bandwidth quotas before
  promoting the full portfolio to public traffic.
- Resend account and a domain whose DNS records you can edit for email
  authentication.
- Verified KoraPay merchant account, payout details, test/live credentials, and
  KoraPay's exact fee and settlement schedule. Put credentials in a trusted
  server/Edge Function secret store, never in browser code or chat.
- Optional AI provider account and an explicit spend cap; provide only
  approved public service and pricing information to the assistant.
- Instagram Professional account, Facebook Page, YouTube channel, X
  developer account, and TikTok developer app, with the relevant authorization
  and platform reviews.

## Official price and setup references

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase billing and quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase storage bandwidth](https://supabase.com/docs/guides/storage/serving/bandwidth)
- [Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [KoraPay accept payments](https://developers.korapay.com/docs/accept-payments.md)
- [KoraPay checkout](https://developers.korapay.com/docs/checkout-standard.md)
- [KoraPay merchant signup](https://merchant.korapay.com/auth/signup)
- [Resend pricing](https://resend.com/pricing)
- [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Instagram API overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Facebook Page posts](https://developers.facebook.com/documentation/pages-api/posts)
- [Meta access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- [YouTube video resource](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [YouTube video upload](https://developers.google.com/youtube/v3/docs/videos/insert)
- [X API create posts](https://docs.x.com/x-api/posts/create-post)
- [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
- [TikTok Content Posting API setup](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [TikTok Direct Post API](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
