# Public project requests and the client portal

The public **Start a project** form captures the visitor's name, email, service,
and brief, then emails a secure, passwordless client-portal sign-in link. The
inquiry is stored first so it remains visible to the studio if the email cannot
be sent. The regular sign-in page also offers this email-link option.

When the client opens the sign-in link, GLYPH links the inquiry to a client
record, creates a shared project in the `inquiry` state, and opens the client
portal. The client can open that project and message the studio. The request
appears in **Studio → Requests** with a new-request badge; the studio can mark
it contacted, accept it, or decline it. **Accept & open chat** accepts the
request, moves the project into planning, and opens the project conversation.
The studio and client can both message from that conversation. Declining
archives the project and removes it from the client portal.

Configure Supabase Auth email delivery (custom SMTP for production) and allow
the public site's `/portal` URL in the Supabase Auth redirect URL settings.
Clients should open the latest sign-in link from the same email address used on
their project request.

Clients with a confirmed portal account can also submit additional project
requests from **Start another project** in the portal. Each request creates a
new shared project in the inquiry state and appears in **Studio → Requests**.
The client can open its project card and message the studio while the studio
reviews it; the studio can accept the request to move the project into planning.

For existing clients, **Studio → Clients → Add a client** can create the client
record, a shared first project, and a portal invitation in one onboarding
flow. The studio shares the generated invitation link with the client; they
must register using the matching email address. After signing in, they can
message the studio on the shared project and access invoices shared to their
portal.
