import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const consultationRates: Record<string, { title: string; duration: number; ngn: number; usd: number }> = {
  'duration-15': { title: 'Consultation by duration · 15 minutes', duration: 15, ngn: 10000, usd: 7 },
  'duration-30': { title: 'Consultation by duration · 30 minutes', duration: 30, ngn: 18000, usd: 13 },
  'duration-45': { title: 'Consultation by duration · 45 minutes', duration: 45, ngn: 25000, usd: 19 },
  'duration-60': { title: 'Consultation by duration · 1 hour', duration: 60, ngn: 35000, usd: 26 },
  'duration-90': { title: 'Consultation by duration · 90 minutes', duration: 90, ngn: 50000, usd: 37 },
  'duration-120': { title: 'Consultation by duration · 2 hours', duration: 120, ngn: 70000, usd: 52 },
  'branding-strategy': { title: 'Branding & Graphic Design Strategy · 1 hour', duration: 60, ngn: 40000, usd: 30 },
  'video-production': { title: 'Video Editing & Production Consultation · 1 hour', duration: 60, ngn: 40000, usd: 30 },
  'motion-graphics': { title: 'Motion Graphics & Animation Consultation · 1 hour', duration: 60, ngn: 40000, usd: 30 },
  'social-content-strategy': { title: 'Social Media & Content Strategy · 1 hour', duration: 60, ngn: 40000, usd: 30 },
  'creative-direction': { title: 'Creative Direction & Business Consultation · 1 hour', duration: 60, ngn: 50000, usd: 37 },
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`The ${name} Supabase function secret is not set.`)
  return value
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function amountString(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('The checkout amount is invalid.')
  return amount.toFixed(2)
}

function requestedDate(value: unknown) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
    : null
  if (!match) return null
  const date = new Date(`${value}:00+01:00`)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return null
  const localParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const local = Object.fromEntries(localParts.map((part) => [part.type, part.value]))
  if ([local.year, local.month, local.day, local.hour, local.minute].some((part, index) => part !== match[index + 1])) {
    return null
  }
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  try {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return response({ error: 'Request body must be valid JSON.' }, 400)
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    if (body.action === 'details') {
      const token = typeof body.token === 'string' ? body.token : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
        return response({ error: 'This receipt link is invalid.' }, 400)
      }
      const { data: purchase, error: purchaseError } = await supabase
        .from('editorial_purchases')
        .select('id, token, purchase_type, product_title, customer_name, customer_email, service_key, duration_minutes, requested_at, requested_timezone, currency, amount, document_storage_path, status, receipt_number, created_at, paid_at, workspace_id')
        .eq('token', token)
        .maybeSingle()
      if (purchaseError) throw new Error(`Could not load the purchase receipt: ${purchaseError.message}`)
      if (!purchase) return response({ error: 'This receipt link is invalid.' }, 404)

      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('studio_name')
        .eq('id', purchase.workspace_id)
        .maybeSingle()
      if (workspaceError) throw new Error(`Could not load the studio details: ${workspaceError.message}`)

      let downloadUrl: string | null = null
      if (purchase.status === 'paid' && purchase.purchase_type === 'document') {
        const signed = await supabase.storage
          .from('paid-blog-documents')
          .createSignedUrl(purchase.document_storage_path, 300, { download: true })
        if (signed.error) throw new Error(`Could not prepare the document download: ${signed.error.message}`)
        downloadUrl = signed.data.signedUrl
      }
      const { workspace_id: _workspaceId, document_storage_path: _documentPath, ...publicPurchase } = purchase
      return response({ purchase: { ...publicPurchase, studio_name: workspace?.studio_name || 'GLYPH Studio', download_url: downloadUrl } })
    }

    if (body.action !== 'checkout') return response({ error: 'Choose a valid purchase action.' }, 400)
    const postSlug = typeof body.post_slug === 'string' ? body.post_slug.trim() : ''
    const purchaseType = body.purchase_type
    const currency = body.currency
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(postSlug)) return response({ error: 'Choose a valid blog post.' }, 400)
    if (!validEmail(email)) return response({ error: 'Enter a valid email address.' }, 400)
    if (name.length > 160) return response({ error: 'Your name must be 160 characters or fewer.' }, 400)
    if (currency !== 'NGN' && currency !== 'USD') return response({ error: 'Choose NGN or USD.' }, 400)
    if (purchaseType !== 'consultation' && purchaseType !== 'document') {
      return response({ error: 'Choose a consultation or paid document.' }, 400)
    }

    const { data: post, error: postError } = await supabase
      .from('blog_posts')
      .select('id, workspace_id, title, status, document_storage_path, document_title, document_ngn_price, document_usd_price')
      .eq('slug', postSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (postError) throw new Error(`Could not load this blog post: ${postError.message}`)
    if (!post) return response({ error: 'This blog post is not available.' }, 404)

    let productTitle: string
    let amount: number
    let serviceKey: string | null = null
    let duration: number | null = null
    let scheduledAt: string | null = null
    if (purchaseType === 'consultation') {
      const rateKey = typeof body.service_key === 'string' ? body.service_key : ''
      const rate = consultationRates[rateKey]
      scheduledAt = requestedDate(body.requested_at)
      if (!rate) return response({ error: 'Choose a consultation service.' }, 400)
      if (!scheduledAt) return response({ error: 'Choose a future date and time in Africa/Lagos.' }, 400)
      if (!post.workspace_id) return response({ error: 'This studio is not available for bookings.' }, 404)
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('contact_email')
        .eq('id', post.workspace_id)
        .maybeSingle()
      if (workspaceError) throw new Error(`Could not load studio contact details: ${workspaceError.message}`)
      if (!workspace?.contact_email) {
        return response({ error: 'The studio has not set a contact email for consultation requests yet.' }, 409)
      }
      productTitle = rate.title
      amount = currency === 'NGN' ? rate.ngn : rate.usd
      serviceKey = rateKey
      duration = rate.duration
    } else {
      if (!post.document_storage_path || !post.document_title) {
        return response({ error: 'This blog post does not have a paid document available.' }, 404)
      }
      productTitle = post.document_title
      amount = Number(currency === 'NGN' ? post.document_ngn_price : post.document_usd_price)
      if (!Number.isFinite(amount) || amount <= 0) {
        return response({ error: 'This document is not configured for the selected currency.' }, 409)
      }
    }

    const { error: newsletterError } = await supabase.from('newsletter_subscribers').upsert({
      workspace_id: post.workspace_id,
      email,
      confirmed_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,email', ignoreDuplicates: true })
    if (newsletterError) {
      throw new Error(`Could not add this email to the mailing list: ${newsletterError.message}`)
    }

    const mode = requiredEnv('BACHS_MODE')
    const apiKey = requiredEnv('BACHS_API_KEY')
    const organizationId = requiredEnv('BACHS_ORGANIZATION_ID')
    const apiUrl = mode === 'sandbox' && apiKey.startsWith('sk_sandbox_')
      ? 'https://sandbox-api.bachs.io'
      : mode === 'live' && apiKey.startsWith('sk_live_')
        ? 'https://api.bachs.io'
        : null
    if (!apiUrl) throw new Error('BACHS_MODE must match the environment of BACHS_API_KEY (sandbox or live).')
    const siteUrl = new URL(requiredEnv('PUBLIC_APP_URL'))
    if (siteUrl.protocol !== 'https:' || siteUrl.search || siteUrl.hash) {
      throw new Error('PUBLIC_APP_URL must be an HTTPS app URL without a query or fragment.')
    }

    const purchaseResult = await supabase.from('editorial_purchases').insert({
      workspace_id: post.workspace_id,
      blog_post_id: post.id,
      purchase_type: purchaseType,
      product_title: productTitle,
      customer_name: name,
      customer_email: email,
      service_key: serviceKey,
      duration_minutes: duration,
      requested_at: scheduledAt,
      requested_timezone: scheduledAt ? 'Africa/Lagos' : null,
      currency,
      amount: amountString(amount),
      document_storage_path: purchaseType === 'document' ? post.document_storage_path : null,
    }).select('id, token').single()
    if (purchaseResult.error) throw new Error(`Could not create the purchase request: ${purchaseResult.error.message}`)

    const reservationResult = await supabase.from('bachs_editorial_checkout_sessions').insert({
      purchase_id: purchaseResult.data.id,
      expected_amount: amountString(amount),
      currency,
      checkout_environment: mode,
      checkout_organization_id: organizationId,
    }).select('id').single()
    if (reservationResult.error) {
      await supabase.from('editorial_purchases').delete().eq('id', purchaseResult.data.id)
      throw new Error(`Could not prepare secure checkout: ${reservationResult.error.message}`)
    }

    const purchaseUrl = `${siteUrl.toString().replace(/\/+$/, '')}/purchase/${purchaseResult.data.token}`
    const providerResponse = await fetch(`${apiUrl}/v1/checkout-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': `glyph-editorial-${reservationResult.data.id}`,
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        pricing: { currency, amount: amountString(amount) },
        billing_currency: currency,
        customer: { email, ...(name ? { name } : {}) },
        success_url: `${purchaseUrl}?payment=returned`,
        cancel_url: purchaseUrl,
        reference: `glyph-editorial-${reservationResult.data.id}`,
      }),
    })
    if (!providerResponse.ok) {
      const providerError = await providerResponse.text()
      console.error('Bachs editorial checkout creation failed:', providerResponse.status, providerError.slice(0, 500))
      await supabase.from('bachs_editorial_checkout_sessions')
        .update({ status: 'failed' })
        .eq('id', reservationResult.data.id)
      return response({ error: 'Bachs could not create this checkout. Please try again shortly.' }, 502)
    }

    const providerPayload = await providerResponse.json()
    const checkout = providerPayload?.data || providerPayload
    let checkoutUrl: URL
    try {
      checkoutUrl = new URL(checkout.checkout_url)
    } catch {
      throw new Error('Bachs returned an invalid hosted checkout URL.')
    }
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.bachs.io') {
      throw new Error('Bachs returned an unexpected hosted checkout URL.')
    }
    if (typeof checkout.checkout_id !== 'string' || !checkout.checkout_id || !checkout.expires_at) {
      throw new Error('Bachs returned incomplete checkout details.')
    }

    const { error: saveError } = await supabase.from('bachs_editorial_checkout_sessions')
      .update({
        bachs_checkout_id: checkout.checkout_id,
        checkout_url: checkout.checkout_url,
        status: 'pending',
        expires_at: checkout.expires_at,
      })
      .eq('id', reservationResult.data.id)
    if (saveError) {
      console.error('Could not save the Bachs editorial checkout session:', saveError.message)
      return response({ error: 'The checkout was created, but its details could not be saved. Contact the studio before retrying.' }, 500)
    }

    return response({ checkout_url: checkout.checkout_url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The checkout request failed.'
    console.error('Editorial checkout request failed:', message)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return response({ error: 'Bachs checkout timed out. Please try again.' }, 504)
    }
    return response({ error: message }, 500)
  }
})
