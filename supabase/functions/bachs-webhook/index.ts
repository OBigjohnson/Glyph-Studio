import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function response(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`The ${name} Supabase function secret is not set.`)
  return value
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

async function verifySignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(',')
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2)
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signedBytes = new TextEncoder().encode(`${timestamp}.${rawBody}`)
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedBytes))
  const expectedHex = Array.from(expected, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return signatures.some((signature) => constantTimeEqual(
    new TextEncoder().encode(signature.toLowerCase()),
    new TextEncoder().encode(expectedHex),
  ))
}

Deno.serve(async (request) => {
  if (request.method === 'GET') return response('Bachs webhook endpoint is online.')
  if (request.method === 'HEAD') return new Response(null, { status: 200 })
  if (request.method !== 'POST') return response('Method not allowed.', 405)

  const signature = request.headers.get('X-Bachs-Signature-V2')
  const secret = Deno.env.get('BACHS_WEBHOOK_SECRET')
  if (!signature || !secret) {
    console.error('Bachs webhook signature header or signing secret is missing.')
    return response('Invalid webhook signature.', 400)
  }

  const rawBody = await request.text()
  if (!await verifySignature(rawBody, signature, secret)) {
    console.error('Rejected a Bachs webhook with an invalid or stale signature.')
    return response('Invalid webhook signature.', 400)
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return response('Invalid JSON payload.', 400)
  }

  if (event?.type !== 'collection.succeeded') return response('Event ignored.')

  const collection = event.data
  let mode: string
  let expectedOrganizationId: string
  try {
    mode = requiredEnv('BACHS_MODE')
    expectedOrganizationId = requiredEnv('BACHS_ORGANIZATION_ID')
  } catch (error) {
    console.error('Bachs webhook account configuration is incomplete:', error instanceof Error ? error.message : error)
    return response('Webhook account configuration is incomplete.', 500)
  }
  if (!['sandbox', 'live'].includes(mode)) {
    console.error('BACHS_MODE must be sandbox or live.')
    return response('Webhook account configuration is invalid.', 500)
  }
  if (event.organization_id !== expectedOrganizationId) {
    console.error('Rejected a Bachs webhook from an unexpected organization.')
    return response('Unexpected Bachs organization.', 400)
  }

  if (
    typeof event.id !== 'string'
    || typeof collection?.checkout_id !== 'string'
    || typeof collection?.charge_id !== 'string'
    || typeof collection?.amount !== 'string'
    || !/^\d+(?:\.\d{1,2})?$/.test(collection.amount)
    || typeof collection?.currency !== 'string'
    || typeof collection?.status !== 'string'
    || collection.status.toUpperCase() !== 'SUCCEEDED'
  ) {
    console.error('Rejected a Bachs collection event with incomplete payment details.')
    return response('Invalid collection event.', 400)
  }

  try {
    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await supabase.rpc('process_bachs_collection', {
      provider_event_id: event.id,
      provider_checkout_id: collection.checkout_id,
      provider_charge_id: collection.charge_id,
      received_amount: collection.amount,
      received_currency: collection.currency,
      provider_paid_at: event.created_at || null,
      requested_environment: mode,
      requested_organization_id: expectedOrganizationId,
    })

    if (error) {
      console.error('Could not process the Bachs payment webhook:', error.message)
      return response('Payment processing failed; retry this delivery.', 500)
    }
    if (data?.status === 'rejected') {
      console.error('Bachs payment was rejected because it did not match the checkout or remaining invoice balance.')
      return response('Payment was not recorded and requires reconciliation.')
    }
    return response('Webhook processed.')
  } catch (error) {
    console.error('Bachs payment webhook failed:', error instanceof Error ? error.message : error)
    return response('Payment processing failed; retry this delivery.', 500)
  }
})
