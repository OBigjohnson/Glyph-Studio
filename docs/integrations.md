# GLYPH integrations roadmap

External integrations are not connected. Do not show an account as connected,
send email, publish content, or report automation success until a trusted
server has verified the provider response. `service_role` keys, OAuth tokens,
and provider secrets must never be placed in `VITE_*` variables.

## Social content calendar

The studio calendar stores workspace-private post plans for Instagram,
Facebook Pages, and X. Each platform post has its own caption, planned local
date/time, optional reference to one existing JPG/PNG portfolio asset, editable
image description, and a manually maintained status. A campaign builder uses
the selected work and an owner-reviewed story (starting point, creative
choices, and what the finished work communicates) to prepare a hook, narrative,
and invitation tailored for Instagram, Facebook Pages, and X. This is
deterministic template-based text generation, not an AI model; it does not
analyze images or invent project details. Review each draft before saving.
GLYPH can copy the caption, download the selected image, and open the platform
for manual scheduling or publishing.

This is a planning and handoff workflow only. GLYPH does not connect social
accounts, transmit content to providers, schedule jobs, publish posts, or verify
the manually recorded status. The campaign builder adds no AI provider, social
API, OAuth, or third-party scheduler dependency. Existing Supabase database,
storage, bandwidth, and hosting limits still apply. Do not store provider
credentials or tokens in this feature.

## Future email, community, and assistant

Custom outbound email requires a verified sending domain, server-side provider
credentials, bounce handling, and user consent. A community needs its own
moderation and access model. An offline inquiry assistant must be constrained
to studio-approved service/pricing information and hand off uncertain or
custom requests; none of these services is currently enabled.

Google Drive is supported as a manually attached project/deliverable URL; no
Drive API integration is required for the current workflow.
