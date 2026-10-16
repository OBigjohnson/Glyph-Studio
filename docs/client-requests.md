# Public project requests and the client portal

The public **Start a project** form captures the visitor's name, email, service,
and brief, then asks them to create a client-portal password. The inquiry is
stored first so it remains visible to the studio even if account setup needs a
retry.

When Supabase allows immediate sign-in after signup, GLYPH links the inquiry to
a client record, creates a shared project in the `inquiry` state, and opens the
client portal. The client can open that project and message the studio. The
request appears in **Studio → Requests** with a new-request badge; the studio
can mark it contacted, accept it, or decline it. **Accept & open chat** accepts
the request, moves the project into planning, and opens the project conversation.
The studio and client can both message from that conversation. Declining archives
the project and removes it from the client portal.

If Supabase email confirmation is enabled, the inquiry is still saved, but the
client must confirm their account and sign in before the portal project is
attached. Confirmation links must be configured to return to `/portal` in the
Supabase Auth URL settings. The app's sign-in page links back to the portal.

Clients with a confirmed portal account can also submit additional project
requests from **Start another project** in the portal. Each request creates a
new shared project in the inquiry state and appears in **Studio → Requests**.
The client can open its project card and message the studio while the studio
reviews it; the studio can accept the request to move the project into planning.
