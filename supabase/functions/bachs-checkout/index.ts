import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function validToken(token: unknown): token is string {
  return typeof token === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
}

function amountString(amount: unknown) {
  if (typeof amount !== 'string' || !/^\d{1,10}\.\d{2}$/.test(amount)) {
    throw new Error('The invoice amount could not be formatted for checkout.')
  }
  return amount
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  try {
    let body: { action?: unknown; token?: unknown; percentage?: unknown }
    try {
      body = await request.json()
    } catch {
      return response({ error: 'Request body must be valid JSON.' }, 400)
    }
    const token = body?.token
    if (!validToken(token)) return response({ error: 'Enter a valid invoice checkout link.' }, 400)
    if (!['details', 'checkout'].includes(body?.action)) {
      return response({ error: 'Choose an invoice payment action.' }, 400)
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    if (body.action === 'details') {
      const { data, error } = await supabase.rpc('get_public_checkout_invoice', {
        target_token: token,
      })
      if (error) {
        console.error('Could not load the public invoice checkout details:', error.message)
        return response({ error: 'Could not load this invoice checkout link.' }, 500)
      }
      if (!data) return response({ error: 'This invoice checkout link is invalid.' }, 404)
      return response({ invoice: data })
    }

    const percentage = Number(body.percentage)
    if (![25, 50, 75, 100].includes(percentage)) {
      return response({ error: 'Choose 25%, 50%, 75%, or the remaining balance.' }, 400)
    }

    const mode = requiredEnv('BACHS_MODE')
    const apiKey = requiredEnv('BACHS_API_KEY')
    const organizationId = requiredEnv('BACHS_ORGANIZATION_ID')
    const apiUrl = mode === 'sandbox' && apiKey.startsWith('sk_sandbox_')
      ? 'https://sandbox-api.bachs.io'
      : mode === 'live' && apiKey.startsWith('sk_live_')
        ? 'https://api.bachs.io'
        : null
    if (!apiUrl) {
      throw new Error('BACHS_MODE must match the environment of BACHS_API_KEY (sandbox or live).')
    }

    const { data: reservation, error: reservationError } = await supabase.rpc('begin_bachs_checkout', {
      target_token: token,
      requested_percentage: percentage,
      requested_environment: mode,
      requested_organization_id: organizationId,
    })
    if (reservationError) {
      if (reservationError.code !== 'P0001') {
        console.error('Could not reserve a Bachs checkout:', reservationError.message)
        return response({ error: 'Could not prepare this invoice checkout. Please try again.' }, 500)
      }
      return response({ error: reservationError.message }, 409)
    }
    if (reservation.status === 'pending' && reservation.checkout_url) {
      return response({
        checkout_url: reservation.checkout_url,
        amount: reservation.amount,
        currency: reservation.currency,
      })
    }

    const siteUrl = new URL(requiredEnv('PUBLIC_APP_URL'))
    if (siteUrl.protocol !== 'https:' || siteUrl.search || siteUrl.hash) {
      throw new Error('PUBLIC_APP_URL must be an HTTPS app URL without a query or fragment.')
    }
    const checkoutPageUrl = `${siteUrl.toString().replace(/\/+$/, '')}/pay/${token}`
    const invoiceResult = await supabase.rpc('get_public_checkout_invoice', {
      target_token: token,
    })
    if (invoiceResult.error) {
      console.error('Could not reload the invoice for Bachs checkout:', invoiceResult.error.message)
      throw new Error('Could not load the invoice for checkout.')
    }
    if (!invoiceResult.data) {
      throw new Error('This invoice checkout link is invalid.')
    }

    const customer = invoiceResult.data.client_email
      ? {
          email: invoiceResult.data.client_email,
          ...(invoiceResult.data.client_name ? { name: invoiceResult.data.client_name } : {}),
        }
      : undefined

    const providerResponse = await fetch(`${apiUrl}/v1/checkout-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': `glyph-invoice-${reservation.reservation_id}`,
      },
      body: JSON.stringify({
        pricing: {
          currency: reservation.currency,
          amount: amountString(reservation.amount),
        },
        billing_currency: reservation.currency,
        ...(customer ? { customer } : {}),
        success_url: `${checkoutPageUrl}?payment=returned`,
        cancel_url: checkoutPageUrl,
        reference: `glyph-${reservation.reservation_id}`,
      }),
    })

    if (!providerResponse.ok) {
      console.error('Bachs checkout creation failed with status:', providerResponse.status)
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

    const { error: finishError } = await supabase.rpc('finish_bachs_checkout', {
      reservation_id: reservation.reservation_id,
      provider_checkout_id: checkout.checkout_id,
      hosted_checkout_url: checkout.checkout_url,
      checkout_expiry: checkout.expires_at,
    })
    if (finishError) {
      console.error('Could not save the Bachs checkout session:', finishError.message)
      return response({ error: 'The checkout was created, but its details could not be saved. Retry to recover it safely.' }, 500)
    }

    return response({
      checkout_url: checkout.checkout_url,
      amount: reservation.amount,
      currency: reservation.currency,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The checkout request failed.'
    console.error('Bachs checkout request failed:', message)
    return response({ error: message }, 500)
  }
})
