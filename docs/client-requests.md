# Public project requests and the client portal

The public **Start a project** form captures the visitor's name, email, service,
and brief, and asks new clients to create and confirm a password. The inquiry
is stored first so it remains visible to the studio if account setup needs
attention.

With Supabase email confirmation disabled, successful signup creates an
authenticated session immediately. GLYPH links the inquiry to a client record,
creates a shared project in the `inquiry` state, and opens the client portal.
The client can open that project and message the studio. The request appears in
**Studio → Requests** with a new-request badge; the studio can mark it
contacted, accept it, or decline it. **Accept & open chat** accepts the request,
moves the project into planning, and opens the project conversation. The studio
and client can both message from that conversation. Declining archives the
project and removes it from the client portal.

For immediate portal entry after signup, turn off **Confirm email** in Supabase
Auth provider settings. If confirmation is enabled, Supabase does not create an
authenticated session until the client confirms their address; they must
confirm first, then sign in with the email and password they created.

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
