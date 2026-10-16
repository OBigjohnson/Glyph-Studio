# GLYPH Studio setup

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

## Deploying the combined app with GitHub Pages

The public portfolio, client portal, and studio workspace deploy together as
one site. GitHub Pages hosts only the frontend; Supabase continues to provide
authentication, database, and file storage.

1. Push this project to a GitHub repository on the `main` branch. The
`.github/workflows/deploy.yml` workflow runs lint and build, then deploys the
site whenever `main` is updated.
2. In the repository, open **Settings → Pages** and set **Build and
deployment → Source** to **GitHub Actions**.
3. Add repository Actions secrets named `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, with the Supabase Project URL and browser-safe anon
public key. Never use a Supabase `service_role` key in this frontend or in
these secrets.
4. Run the workflow from **Actions → Deploy GLYPH Studio to GitHub Pages →
Run workflow**, or push a commit to `main`. The workflow publishes the
portfolio, portal, and studio app at the same Pages address. For a repository
named `owner.github.io`, the address is the domain root; for any other
repository it includes the repository name in the path.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to
the deployed site URL and add that same URL plus `/**` to the allowed redirect
URLs. For example, a project site at `https://owner.github.io/glyph-studio/`
needs `https://owner.github.io/glyph-studio/**`. The build sets
`VITE_SITE_URL` to the Pages URL so email confirmation and password-reset links
return to the deployed app.

The Vite build uses the repository path as its base URL, configures React
Router with that base, and emits a `404.html` SPA fallback. This lets direct
links and refreshes work for routes such as `/portfolio`, `/portal`, and
`/studio/finance`. `.env.local` and other `.env` files are ignored by Git so
local credentials are not committed.

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

KoraPay checkout, verified webhooks, receipt issuance, social OAuth and
scheduling, outbound email, community features, and AI responses are not
implemented or configured. The UI labels these as unavailable rather than
simulating success. See `payments.md` and `integrations.md` for the intended
server-side boundaries. See `portfolio.md` to import and publish your artwork
and `costs.md` for the current free/low-cost provider limits, exact known
prices, and account setup checklist.
