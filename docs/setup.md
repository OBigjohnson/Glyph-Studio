gh -# GLYPH Studio setup

## Supabase

1. Create a Supabase project.
2. The current project has the clean-start baseline
   `20261012084630_glyph_studio.sql` and the additive
   `20261012093000_portfolio_uploads_and_site_personalization.sql`, plus
   `20261013133500_project_deliverable_feedback.sql`.
   Do not apply the baseline to a database whose data you need to preserve.
3. Set up the Supabase CLI and link this folder to the intended project.
   The destructive remote reset is a separate, explicit operation; back up any
   data you need before running it.
4. In the project settings, copy the **Project URL** and browser-safe **anon
   public key**.
5. Create `.env.local` in the project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Restart Vite after changing environment variables. Never put a `service_role`
key in this app or commit `.env.local`.

Without both variables, public pages still render but Supabase-backed actions
show a setup error. Studio and Portal routes require a real authenticated
Supabase session; there is no demo login or mock business data.

## Android Studio app

The separate Expo project in [`mobile-app/`](../mobile-app/) builds an
installable Android app that opens the private `/studio` workspace. It uses
the existing website authentication and requires an internet connection; it
does not duplicate the website or expose server credentials. See its
[build instructions](../mobile-app/README.md) to link an Expo account and
create an EAS APK.

## Auth

Enable the email provider in **Authentication → Providers**. Configure the site
URL and redirect URLs (for local development, `http://localhost:5173`) in
**Authentication → URL Configuration**. Email confirmation and password-reset
links return to `/sign-in`.

## Development

```bash
npm install
npm run dev
```

## Gemini social content

The social calendar uses Gemini only from an authenticated Supabase Edge
Function. The API key is a server-side Function secret and must never be added
to `.env.local`, a `VITE_*` variable, the website, or the Expo app.

1. Apply the database migration and deploy the function to the linked Supabase
   project:

   ```bash
   supabase db push
   supabase functions deploy generate-social-content
   ```

2. Create a Gemini API key in
   [Google AI Studio](https://aistudio.google.com/app/apikey) and add it as a
   Supabase Function secret named exactly `GEMINI_API_KEY` (including the
   underscores). `GEMINI_MODEL` is optional; the default is the faster
   `gemini-3.5-flash-lite`.

   ```bash
   supabase secrets set GEMINI_API_KEY=your_gemini_api_key GEMINI_MODEL=gemini-3.5-flash-lite
   ```

   Educational posts also generate a social image with the Gemini image model
   `gemini-nano-banana-2.1`. To override it, set the optional
   `GEMINI_IMAGE_MODEL` Supabase Function secret. Image generation may use
   additional API quota or incur charges.

3. In Studio settings, choose the platforms to include. Open the social
   calendar, generate drafts, review/edit each one, and save. GLYPH tracks
   copies, manual "used" actions, and manually recorded publication; posting
   remains a manual action.

Gemini use may incur charges under your Google AI plan. Generated material
should be fact-checked before publishing. See
[`integrations.md`](./integrations.md#gemini-social-content) for data flow and
the feature's limits.

## Deploying the combined app with Vercel

The public portfolio, client portal, and studio workspace deploy together as
one site. Vercel hosts the frontend; Supabase continues to provide
authentication, database, and file storage.

1. Import this GitHub repository in Vercel and use the Vite framework preset.
The project defaults to `npm run build` and `dist` as the output directory.
2. In the Vercel project, open **Settings → Environment Variables** and add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production, Preview, and
Development as needed. Use the Supabase Project URL and browser-safe anon
public key. Never add a Supabase `service_role` key to this frontend or to
Vercel.
3. Redeploy after adding or changing environment variables. Vite embeds these
values at build time; they are not runtime server secrets.
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to the
production Vercel URL and add it plus `/**` to the allowed redirect URLs. Add
the Vercel preview URL pattern if authentication should work on preview
deployments. Email confirmation and password-reset links return to
`/sign-in`.

`vercel.json` rewrites application routes to the SPA entry point so direct
links and refreshes work for paths such as `/portfolio`, `/portal`, and
`/studio/finance` and `/pay/<invoice-token>`. `.env.local`, other `.env` files,
and Vercel's local project link are ignored by Git so credentials and local
configuration are not committed.

## Bachs invoice checkout

The Bachs integration uses Supabase Edge Functions; the secret key and webhook
signing secret never go in frontend environment variables.

1. Create and verify a **Bachs merchant account for the studio** at
   [app.bachs.io/signup](https://app.bachs.io/signup). Complete Bachs' live
   business verification and add the studio's payout destination in Bachs.
   Set the merchant/business name there to the studio's customer-facing or
   registered business name. GLYPH does not create a Bachs account or control
   the merchant name shown on Bachs-hosted checkout; the Bachs account that
   owns the API key receives the payments into its Bachs balance.

2. Apply both checkout migrations with the Supabase CLI:

   ```bash
   supabase db push
   ```

3. In that same Bachs account, create a production API key with the
   `payments:write` scope. In Supabase **Project Settings → API Keys**, copy
   the browser-safe **publishable** key (or legacy `anon` key); never use the
   `service_role` or secret key here. Supabase's function gateway requires an
   API key even when JWT verification is disabled, so include this public key
   as the `apikey` query parameter in the Bachs webhook destination:

   ```text
   https://<project-ref>.supabase.co/functions/v1/bachs-webhook?apikey=<SUPABASE_PUBLISHABLE_OR_ANON_KEY>
   ```

   Configure this destination under the production account and subscribe to
   `collection.succeeded`. Keep the production key, webhook signing secret,
   and account's `organization_id` available for the next step. The publishable
   key is intended for public clients; do not put a service-role key in the URL.

4. Add the Bachs **live** credentials and public deployed app URL as Supabase
   Function secrets:

   ```bash
   supabase secrets set BACHS_MODE=live BACHS_API_KEY=sk_live_your_key BACHS_WEBHOOK_SECRET=your_live_signing_secret BACHS_ORGANIZATION_ID=acct_your_organization_id PUBLIC_APP_URL=https://your-site.example
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to deployed
   Supabase Edge Functions. Do not add the service-role key to `.env.local` or
   any `VITE_*` variable. The mode must match the key prefix. The webhook also
   checks the event's Bachs `organization_id` against the configured account
   before recording a payment.

5. Deploy the checkout and webhook functions:

   ```bash
   supabase functions deploy bachs-checkout
   supabase functions deploy bachs-webhook
   ```

6. Before accepting a real client payment, test the complete flow against
   Bachs sandbox using a separate Supabase project or set of function secrets:

   ```bash
   supabase secrets set BACHS_MODE=sandbox BACHS_API_KEY=sk_sandbox_your_key BACHS_WEBHOOK_SECRET=your_sandbox_signing_secret BACHS_ORGANIZATION_ID=acct_your_sandbox_organization_id PUBLIC_APP_URL=https://your-site.example
   ```

   Confirm the checkout returns in the invoice currency, a signed webhook
   records the payment once, receipts show the correct balance, and Finance
   and the client portal update. Do not switch the production project's secrets
   to sandbox for testing; checkout reservations are isolated by mode, but
   production should remain configured with live credentials.

7. Verify the first real low-value payment in Bachs and GLYPH: check the
   merchant name and payout account in Bachs, confirm the payment appears in
   the studio's Bachs balance, and confirm GLYPH creates one receipt only
   after the signed production webhook arrives.

Bachs checkout links are public bearer links for a specific invoice. Send them
only to the intended payer. Receipts are available on the same link after
payment; GLYPH does not email receipts.

To have the payer cover Bachs' processing fee, set the Bachs account checkout
fee preference to `customer_pays` in the Bachs dashboard before sharing live
checkout links. The Bachs API also exposes this account setting through
`PUT /v1/accounts/checkout/settings` with `{"fee_preference":"customer_pays"}`;
it may require account-settings write permission. This preference passes
through checkout processing fees, not separate payout/withdrawal fees. GLYPH
does not add a separate fixed NGN 100 surcharge.

The baseline creates workspaces, client records and invitations, projects,
tasks, notes, links, messages, portfolio items, inquiries, invoices, expenses,
payments, receipts, activity, and the private portfolio-media bucket, with
workspace/client RLS. An authenticated client can accept a matching email
invitation and see explicitly shared projects.

The additive project-deliverable-feedback migration enables comments, revision
requests, and approvals on project links explicitly shared with a client.
Clients cannot read or post feedback on private links; feedback entries are
append-only.
Project tasks can be shared individually and are organized into a To do, In
progress, and Done board in the studio and client project room. Only studio
members can change task status.
Project notes include starter templates for briefs, meeting notes, decision
records, and delivery checklists; edit the generated text before saving it.
The studio Search page looks across client names, project names, task titles,
and project note text within the signed-in workspace.
Project conversations are stored per project and update live while both
participants have the project open. The project-message Realtime migration also
adds per-user read cursors and unread-message badges in the studio project
navigation and client portal. These badges persist until the conversation is
opened; email and browser push notifications are not configured.
Project owners can edit the project brief, service, status, deadline, and
client-portal sharing setting from the project overview.
Studio owners can print or save invoices as PDFs and explicitly share them to a
client's portal from Finance. Clients can print invoices shared with their
portal account. Receipts are printable by both sides only after a verified
payment has issued one.

Bachs checkout, signed webhook verification, and receipt issuance are
implemented, but require the migration, Edge Function secrets, and webhook
destination above. Social OAuth and scheduling, outbound email, community
features, and AI responses are not implemented. See `payments.md` and
`integrations.md` for the server-side boundaries. See `portfolio.md` to import
and publish your artwork and `costs.md` for the current free/low-cost provider
limits, known prices, and account setup checklist.
