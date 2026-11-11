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

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

function emailHtml(body: string, unsubscribeUrl: string, previewText: string) {
  const paragraphs = body.split(/\n{2,}/).map((paragraph) => (
    `<p style="margin:0 0 18px;line-height:1.7">${htmlEscape(paragraph).replace(/\n/g, '<br>')}</p>`
  )).join('')
  const preheader = previewText
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${htmlEscape(previewText)}</span>`
    : ''
  return `${preheader}<div style="font-family:Arial,sans-serif;color:#211d2b;max-width:620px;margin:0 auto;padding:32px 20px">${paragraphs}<hr style="border:0;border-top:1px solid #e8e5ee;margin:32px 0 16px"><p style="font-size:12px;color:#777">You received this because you subscribed to GLYPH Studio updates. <a href="${htmlEscape(unsubscribeUrl)}">Unsubscribe</a></p></div>`
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

    const action = body.action
    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    if (action === 'subscribe') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const workspaceSlug = typeof body.workspace_slug === 'string' ? body.workspace_slug.trim() : ''
      if (typeof body.website === 'string' && body.website) return response({ ok: true })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug)) {
        return response({ error: 'Enter a valid email address.' }, 400)
      }

      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .select('id, studio_name')
        .eq('slug', workspaceSlug)
        .maybeSingle()
      if (workspaceError) throw new Error(`Could not find the newsletter workspace: ${workspaceError.message}`)
      if (!workspace) return response({ error: 'The mailing list is not available.' }, 404)

      const { data: existing, error: existingError } = await supabase
        .from('newsletter_subscribers')
        .select('id, confirmed_at, unsubscribed_at')
        .eq('workspace_id', workspace.id)
        .eq('email', email)
        .maybeSingle()
      if (existingError) throw new Error(`Could not check the mailing list: ${existingError.message}`)
      if (existing?.confirmed_at && !existing.unsubscribed_at) return response({ ok: true })

      const confirmationToken = crypto.randomUUID()
      const unsubscribeToken = crypto.randomUUID()
      const { error: saveError } = await supabase.from('newsletter_subscribers').upsert({
        workspace_id: workspace.id,
        email,
        confirmation_token: confirmationToken,
        unsubscribe_token: unsubscribeToken,
        confirmed_at: null,
        unsubscribed_at: null,
      }, { onConflict: 'workspace_id,email' })
      if (saveError) throw new Error(`Could not save your subscription request: ${saveError.message}`)

      const appUrl = requiredEnv('PUBLIC_APP_URL').replace(/\/+$/, '')
      const confirmationUrl = `${appUrl}/newsletter/confirm?token=${encodeURIComponent(confirmationToken)}`
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          from: requiredEnv('NEWSLETTER_FROM'),
          to: [email],
          subject: `Confirm your ${workspace.studio_name} newsletter subscription`,
          text: `Thanks for signing up for ${workspace.studio_name} updates. Confirm your subscription: ${confirmationUrl}\n\nIf you did not sign up, you can ignore this email.`,
          html: `<div style="font-family:Arial,sans-serif;color:#211d2b;max-width:600px;margin:0 auto;padding:32px 20px"><h1 style="font-size:24px">One quick step</h1><p>Confirm that you want to receive thoughtful brand and creative notes from ${htmlEscape(workspace.studio_name)}.</p><p><a href="${htmlEscape(confirmationUrl)}" style="display:inline-block;padding:13px 18px;background:#171717;color:#fff;text-decoration:none">Confirm subscription</a></p><p style="font-size:12px;color:#777">If you did not sign up, you can ignore this email.</p></div>`,
        }),
      })
      if (!resendResponse.ok) {
        const providerError = await resendResponse.text()
        console.error('Resend confirmation email failed:', resendResponse.status, providerError.slice(0, 500))
        return response({ error: 'Your request was saved, but the confirmation email could not be sent. Please try again later.' }, 502)
      }
      return response({ ok: true })
    }

    if (action === 'confirm' || action === 'unsubscribe') {
      const token = typeof body.token === 'string' ? body.token : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
        return response({ error: 'This newsletter link is invalid or has expired.' }, 400)
      }
      const tokenColumn = action === 'confirm' ? 'confirmation_token' : 'unsubscribe_token'
      const { data: subscriber, error: subscriberError } = await supabase
        .from('newsletter_subscribers')
        .select('id, confirmed_at, unsubscribed_at')
        .eq(tokenColumn, token)
        .maybeSingle()
      if (subscriberError) throw new Error(`Could not verify the newsletter link: ${subscriberError.message}`)
      if (!subscriber) return response({ error: 'This newsletter link is invalid or has expired.' }, 404)
      if (action === 'confirm') {
        if (subscriber.unsubscribed_at) return response({ error: 'This subscription has been unsubscribed.' }, 400)
        if (!subscriber.confirmed_at) {
          const { error: updateError } = await supabase.from('newsletter_subscribers')
            .update({ confirmed_at: new Date().toISOString(), confirmation_token: crypto.randomUUID() })
            .eq('id', subscriber.id)
          if (updateError) throw new Error(`Could not confirm the subscription: ${updateError.message}`)
        }
        return response({ ok: true, message: 'Your subscription is confirmed. Thanks for joining.' })
      }
      if (!subscriber.unsubscribed_at) {
        const { error: updateError } = await supabase.from('newsletter_subscribers')
          .update({ unsubscribed_at: new Date().toISOString() })
          .eq('id', subscriber.id)
        if (updateError) throw new Error(`Could not unsubscribe this address: ${updateError.message}`)
      }
      return response({ ok: true, message: 'This email address has been unsubscribed.' })
    }

    if (action !== 'send') return response({ error: 'Choose a valid newsletter action.' }, 400)
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return response({ error: 'Sign in to send a newsletter.' }, 401)
    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return response({ error: 'Your session is invalid. Sign in again.' }, 401)
    const { data: membership, error: membershipError } = await supabase
      .from('members')
      .select('workspace_id, role')
      .eq('user_id', authData.user.id)
      .eq('role', 'owner')
      .maybeSingle()
    if (membershipError) throw new Error(`Could not verify studio access: ${membershipError.message}`)
    if (!membership?.workspace_id) return response({ error: 'No studio workspace is available for this account.' }, 403)

    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const content = typeof body.body === 'string' ? body.body.trim() : ''
    const previewText = typeof body.preview_text === 'string' ? body.preview_text.trim() : ''
    const alternateSubjects = Array.isArray(body.alternate_subjects)
      ? body.alternate_subjects.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 2)
      : []
    const storybrandAngle = body.storybrand_angle && typeof body.storybrand_angle === 'object'
      ? body.storybrand_angle
      : {}
    if (!subject || subject.length >= 50 || !content || content.length > 12_000 || previewText.length > 200) {
      return response({ error: 'Add an email subject and body within the allowed lengths.' }, 400)
    }
    const { data: subscribers, error: subscriberError } = await supabase
      .from('newsletter_subscribers')
      .select('email, unsubscribe_token')
      .eq('workspace_id', membership.workspace_id)
      .not('confirmed_at', 'is', null)
      .is('unsubscribed_at', null)
      .order('created_at')
    if (subscriberError) throw new Error(`Could not load confirmed subscribers: ${subscriberError.message}`)
    if (!subscribers?.length) return response({ error: 'There are no confirmed subscribers to email yet.' }, 400)
    if (subscribers.length > 100) {
      return response({ error: 'This first version sends one batch of up to 100 confirmed subscribers. No email was sent; narrow the audience or split the campaign.' }, 400)
    }

    const appUrl = requiredEnv('PUBLIC_APP_URL').replace(/\/+$/, '')
    const from = requiredEnv('NEWSLETTER_FROM')
    const emails = subscribers.map((subscriber) => {
      const unsubscribeUrl = `${appUrl}/newsletter/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`
      return {
        from,
        to: [subscriber.email],
        subject,
        text: `${content}\n\nUnsubscribe: ${unsubscribeUrl}`,
        html: emailHtml(content, unsubscribeUrl, previewText),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
        },
      }
    })
    const resendResponse = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(emails),
    })
    const providerBody = await resendResponse.text()
    if (!resendResponse.ok) {
      console.error('Resend newsletter batch failed:', resendResponse.status, providerBody.slice(0, 1000))
      return response({ error: 'Resend did not accept the newsletter. No successful send was confirmed; check your provider and try again.' }, 502)
    }
    let providerResult: { data?: unknown }
    try {
      providerResult = JSON.parse(providerBody)
    } catch {
      console.error('Resend returned an unreadable batch response.')
      return response({ error: 'Resend returned an unreadable response. Check the provider dashboard before retrying.' }, 502)
    }
    if (!Array.isArray(providerResult.data) || providerResult.data.length !== subscribers.length) {
      console.error('Resend batch result did not match the requested recipient count.')
      return response({ error: 'Resend accepted an unclear number of emails. Check the provider dashboard before retrying.' }, 502)
    }

    const { error: logError } = await supabase.from('newsletter_campaigns').insert({
      workspace_id: membership.workspace_id,
      sent_by: authData.user.id,
      subject,
      preview_text: previewText,
      alternate_subjects: alternateSubjects,
      storybrand_angle: storybrandAngle,
      body: content,
      recipient_count: subscribers.length,
    })
    if (logError) {
      console.error('Newsletter was accepted by Resend but the send log failed:', logError.message)
      return response({ error: `Resend accepted the email batch for ${subscribers.length} subscribers, but GLYPH could not save the send log. Check Resend before retrying. (${logError.message})` }, 500)
    }
    return response({ ok: true, recipient_count: subscribers.length })
  } catch (error) {
    console.error('Could not process newsletter request:', error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return response({ error: 'The email provider timed out. Check its dashboard before retrying.' }, 504)
    }
    return response({ error: error instanceof Error ? error.message : 'Could not process the newsletter request.' }, 500)
  }
})
