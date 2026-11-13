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

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
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
    const editorialResult = await supabase.rpc('process_bachs_editorial_collection', {
      provider_event_id: event.id,
      provider_checkout_id: collection.checkout_id,
      provider_charge_id: collection.charge_id,
      received_amount: collection.amount,
      received_currency: collection.currency,
      provider_paid_at: event.created_at || null,
      requested_environment: mode,
      requested_organization_id: expectedOrganizationId,
    })
    if (editorialResult.error) {
      console.error('Could not process the Bachs editorial payment webhook:', editorialResult.error.message)
      return response('Payment processing failed; retry this delivery.', 500)
    }

    if (editorialResult.data?.status !== 'not_found') {
      if (editorialResult.data?.status === 'rejected') {
        console.error('Bachs editorial payment was rejected because it did not match the checkout.')
        return response('Payment was not recorded and requires reconciliation.')
      }

      const purchaseId = editorialResult.data?.purchase_id
      if (purchaseId) {
        const { data: purchase, error: purchaseError } = await supabase
          .from('editorial_purchases')
          .select('id, token, workspace_id, purchase_type, product_title, customer_name, customer_email, duration_minutes, requested_at, requested_timezone, currency, amount, status, receipt_number, paid_at, notification_sent_at')
          .eq('id', purchaseId)
          .maybeSingle()
        if (purchaseError || !purchase) {
          console.error('Could not load the paid editorial purchase for email delivery:', purchaseError?.message || 'Purchase not found.')
          return response('Payment was recorded, but purchase email delivery could not be prepared.', 500)
        }

        if (purchase.status === 'paid' && !purchase.notification_sent_at) {
          const { data: claimed, error: claimError } = await supabase.rpc(
            'claim_editorial_purchase_notification',
            { target_purchase_id: purchase.id },
          )
          if (claimError) {
            console.error('Could not claim editorial purchase email delivery:', claimError.message)
            return response('Payment was recorded, but email delivery could not be prepared.', 500)
          }
          if (!claimed) return response('Editorial payment processed; notification is already being delivered.')

          const { data: workspace, error: workspaceError } = await supabase
            .from('workspaces')
            .select('studio_name, contact_email')
            .eq('id', purchase.workspace_id)
            .maybeSingle()
          if (workspaceError || !workspace) {
            console.error('Could not load the studio for editorial purchase emails:', workspaceError?.message || 'Workspace not found.')
            return response('Payment was recorded, but purchase email delivery could not be prepared.', 500)
          }

          const appUrl = requiredEnv('PUBLIC_APP_URL').replace(/\/+$/, '')
          const from = requiredEnv('NEWSLETTER_FROM')
          const receiptUrl = `${appUrl}/purchase/${encodeURIComponent(purchase.token)}`
          const studioName = workspace.studio_name || 'GLYPH Studio'
          const amount = `${purchase.currency} ${Number(purchase.amount).toFixed(2)}`
          const requestedTime = purchase.requested_at
            ? new Intl.DateTimeFormat('en-GB', {
              dateStyle: 'full',
              timeStyle: 'short',
              timeZone: 'Africa/Lagos',
            }).format(new Date(`${purchase.requested_at}+01:00`))
            : ''
          const serviceDetails = purchase.purchase_type === 'consultation'
            ? `<p>Requested time: ${htmlEscape(requestedTime)} (${htmlEscape(purchase.requested_timezone || 'Africa/Lagos')})</p><p>Duration: ${Number(purchase.duration_minutes)} minutes</p>`
            : ''
          const receiptHtml = `<div style="font-family:Arial,sans-serif;color:#211d2b;max-width:620px;margin:0 auto;padding:32px 20px"><h1 style="font-size:24px">Payment receipt</h1><p>Thank you for your payment to ${htmlEscape(studioName)}.</p><p><b>${htmlEscape(purchase.product_title)}</b><br>${htmlEscape(amount)}</p><p>Receipt: ${htmlEscape(purchase.receipt_number)}</p>${serviceDetails}<p><a href="${htmlEscape(receiptUrl)}">View your receipt${purchase.purchase_type === 'document' ? ' and download your document' : ''}</a></p></div>`
          const sendEmail = async (to: string, subject: string, html: string) => {
            const result = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
                'Content-Type': 'application/json',
              },
              signal: AbortSignal.timeout(15_000),
              body: JSON.stringify({ from, to: [to], subject, html }),
            })
            if (!result.ok) {
              const providerError = await result.text()
              console.error('Resend editorial purchase email failed:', result.status, providerError.slice(0, 500))
              throw new Error('Resend did not accept the editorial purchase email.')
            }
          }

          try {
            await sendEmail(purchase.customer_email, `Your GLYPH Studio receipt · ${purchase.receipt_number}`, receiptHtml)
            if (purchase.purchase_type === 'consultation') {
              if (!workspace.contact_email) throw new Error('The studio contact email is not configured.')
              const requestHtml = `<div style="font-family:Arial,sans-serif;color:#211d2b;max-width:620px;margin:0 auto;padding:32px 20px"><h1 style="font-size:24px">Paid consultation request</h1><p><b>${htmlEscape(purchase.product_title)}</b></p><p>Client: ${htmlEscape(purchase.customer_name || 'Not provided')}<br>Email: ${htmlEscape(purchase.customer_email)}</p>${serviceDetails}<p>Paid: ${htmlEscape(amount)}<br>Receipt: ${htmlEscape(purchase.receipt_number)}</p></div>`
              await sendEmail(workspace.contact_email, `Paid consultation request · ${purchase.customer_name || purchase.customer_email}`, requestHtml)
            }
          } catch (emailError) {
            console.error('Editorial purchase notification delivery failed:', emailError instanceof Error ? emailError.message : emailError)
            const { error: releaseError } = await supabase.from('editorial_purchases')
              .update({ notification_claimed_at: null })
              .eq('id', purchase.id)
              .is('notification_sent_at', null)
            if (releaseError) console.error('Could not release the editorial purchase notification claim:', releaseError.message)
            return response('Payment was recorded, but email delivery failed; retry this webhook.', 500)
          }

          const { error: notifiedError } = await supabase.from('editorial_purchases')
            .update({ notification_claimed_at: null, notification_sent_at: new Date().toISOString() })
            .eq('id', purchase.id)
            .is('notification_sent_at', null)
          if (notifiedError) {
            console.error('Editorial purchase emails were sent but their delivery could not be recorded:', notifiedError.message)
            return response('Payment was recorded and email was sent, but delivery status could not be saved.', 500)
          }
        }
      }
      return response('Editorial payment processed.')
    }

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
