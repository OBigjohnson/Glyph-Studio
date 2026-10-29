import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowDownRight, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleUserRound, Copy, Download, ExternalLink, FileText, FolderKanban, ImagePlus, Link2, LockKeyhole, LogOut, Menu, MessageCircle, Palette, Plus, Search, Send, Settings2, Sparkles, Trash2, Users, X } from 'lucide-react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { supabase, supabaseUrl, isSupabaseConfigured, supabaseConfigMessage } from './lib/supabase'
import './styles.css'

const services = ['Brand identity', 'Logo design', 'Graphic design', 'UI/UX', 'Mobile App Development', 'Web Development', 'Video editing', 'Videography', 'Photography']
const portfolioSegments = ['Design', 'Branding', 'Graphic Design', 'UI/UX', 'Mobile App Development', 'Web Development', 'Video Editing', 'Videography', 'Photography']
const studioOwnerEmail = 'specificvisuals09@gmail.com'
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')
const PublicStudioContext = createContext({ studio: null, error: '', refreshStudio: async () => {} })
const UnreadProjectMessagesContext = createContext({ counts: {}, markRead: async () => {} })

function appPath(path) {
  return `${appBasePath}${path.startsWith('/') ? path : `/${path}`}`
}

function publicAsset(path) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

async function uploadPortfolioFile(path, file, mimeType) {
  if (!supabase || !supabaseUrl) return { error: new Error(supabaseConfigMessage) }
  if (file.size <= 6 * 1024 * 1024) {
    return supabase.storage.from('portfolio-media').upload(path, file, { contentType: mimeType, upsert: false })
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) return { error: sessionError }
  if (!sessionData.session?.access_token) return { error: new Error('Sign in again before uploading large files.') }
  const { Upload } = await import('tus-js-client')

  return new Promise((resolve) => {
    const upload = new Upload(file, {
      endpoint: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${sessionData.session.access_token}`,
        'x-upsert': 'false',
      },
      metadata: {
        bucketName: 'portfolio-media',
        objectName: path,
        contentType: mimeType,
        cacheControl: '3600',
      },
      onError: (error) => resolve({ error }),
      onSuccess: () => resolve({ error: null }),
    })
    upload.start()
  })
}

function safeAuthReturnPath(path) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /%(2f|5c)/i.test(path)) return false
  const parsed = new URL(path, window.location.origin)
  return parsed.origin === window.location.origin
    && (parsed.pathname === '/studio' || parsed.pathname.startsWith('/studio/')
      || parsed.pathname === '/portal' || parsed.pathname.startsWith('/portal/'))
}

function PublicStudioProvider({ children }) {
  const [studio, setStudio] = useState(null)
  const [error, setError] = useState('')
  const refreshStudio = useCallback(async () => {
    if (!supabase) return
    const { data, error: queryError } = await supabase.rpc('get_public_studio').maybeSingle()
    if (queryError) {
      setError(queryError.message)
      return
    }
    setStudio(data)
    setError('')
  }, [])
  useEffect(() => { refreshStudio() }, [refreshStudio])
  return <PublicStudioContext.Provider value={{ studio, error, refreshStudio }}>
    <div className="app-root" style={{ '--studio-blue': studio?.brand_color || '#2946d8' }}>{children}</div>
  </PublicStudioContext.Provider>
}

function usePublicStudio() {
  return useContext(PublicStudioContext)
}

async function attachPortfolioCovers(items) {
  if (!supabase) return { data: items.map((item) => ({ ...item, cover_url: '' })), error: null }
  const results = await Promise.all(items.map(async (item) => {
    if (!item.cover_path) return { data: { ...item, cover_url: '' }, error: null }
    const signed = await supabase.storage.from('portfolio-media').createSignedUrl(item.cover_path, 3600)
    return signed.error
      ? { data: { ...item, cover_url: '' }, error: signed.error }
      : { data: { ...item, cover_url: signed.data.signedUrl }, error: null }
  }))
  const failure = results.find((result) => result.error)
  return { data: results.map((result) => result.data), error: failure?.error || null }
}

async function attachPortfolioAssets(itemId) {
  if (!supabase) return { data: [], error: null }
  const { data, error } = await supabase.from('portfolio_assets')
    .select('id, file_name, mime_type, storage_path, sort_order')
    .eq('portfolio_item_id', itemId)
    .order('sort_order')
  if (error) return { data: [], error }
  const assets = await Promise.all((data || []).map(async (asset) => {
    const signed = await supabase.storage.from('portfolio-media').createSignedUrl(asset.storage_path, 3600)
    return signed.error
      ? { data: { ...asset, url: '' }, error: signed.error }
      : { data: { ...asset, url: signed.data.signedUrl }, error: null }
  }))
  const failure = assets.find((asset) => asset.error)
  return { data: assets.map((asset) => asset.data), error: failure?.error || null }
}

function useProjectMessageUpdates(projectId, userId, setMessages) {
  useEffect(() => {
    if (!supabase || !projectId || !userId) return undefined
    const channel = supabase.channel(`project-messages:${projectId}:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'project_messages',
        filter: `project_id=eq.${projectId}`,
      }, ({ new: message }) => {
        setMessages((current) => current.some((entry) => entry.id === message.id)
          ? current
          : [...current, message])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId, setMessages, userId])
}

function useUnreadProjectMessages(userId, reportError) {
  const [counts, setCounts] = useState({})
  const refresh = useCallback(async () => {
    if (!supabase || !userId) {
      setCounts({})
      return
    }
    const { data, error } = await supabase.rpc('get_unread_project_message_counts')
    if (error) {
      reportError(error.message)
      return
    }
    setCounts(Object.fromEntries((data || []).map((row) => [row.project_id, Number(row.unread_count)])))
  }, [reportError, userId])
  useEffect(() => {
    if (!supabase || !userId) return undefined
    refresh()
    const channel = supabase.channel(`unread-project-messages:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'project_messages',
      }, () => { refresh() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refresh, userId])
  const markRead = useCallback(async (workspaceId, projectId) => {
    if (!supabase || !userId) return
    const { error } = await supabase.from('project_message_reads').upsert({
      workspace_id: workspaceId,
      project_id: projectId,
      user_id: userId,
      last_read_at: new Date().toISOString(),
    }, { onConflict: 'project_id,user_id' })
    if (error) {
      reportError(error.message)
      return
    }
    await refresh()
  }, [refresh, reportError, userId])
  return { counts, markRead, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }
}

function Brand({ light = false }) {
  const { studio } = usePublicStudio()
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`}><img src={publicAsset('assets/glyph-logo.jpg')} alt="" /><span>{studio?.studio_name || 'GLYPH'}<small>{studio?.tagline || 'CREATIVE STUDIO'}</small></span></Link>
}

function SiteNav() {
  const [open, setOpen] = useState(false)
  return <header className="site-nav wrap">
    <Brand />
    <button className="mobile-toggle" aria-label="Toggle menu" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    <nav className={open ? 'nav-links nav-open' : 'nav-links'}>
      <Link to="/portfolio">Selected work</Link><Link to="/#services">What we do</Link><Link to="/#studio">The studio</Link>
      <Link to="/studio" className="nav-login">Studio sign in</Link>
      <Link to="/contact" className="nav-cta">Start a project <ArrowRight size={15} /></Link>
    </nav>
  </header>
}

function SiteFooter() {
  const { studio } = usePublicStudio()
  return <footer className="site-footer"><div className="wrap footer-content"><Brand light /><p>{studio?.about_text || 'Good work, made with intention.'}</p><div className="footer-links"><Link to="/portfolio">Portfolio</Link><Link to="/contact">Contact</Link></div><small>© {new Date().getFullYear()} {studio?.studio_name || 'GLYPH Creative Studio'}</small></div></footer>
}

function PublicHome() {
  const { studio, error: studioError } = usePublicStudio()
  const [work, setWork] = useState([])
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (!supabase) return
    supabase.from('portfolio_items').select('id, slug, title, service, summary, cover_path, featured').eq('published', true).order('featured', { ascending: false }).order('created_at', { ascending: false }).limit(3)
      .then(async ({ data, error }) => {
        if (error) { setLoadError(error.message); return }
        const signed = await attachPortfolioCovers(data || [])
        if (signed.error) setLoadError(signed.error.message)
        setWork(signed.data)
      })
  }, [])
  return <div className="public-site marketing-site">
    <SiteNav />
    <main>
      {studioError && <p className="wrap notice-error">{studioError}</p>}
      <section className="hero wrap">
        <div className="hero-copy"><p className="kicker"><i /> {studio?.tagline || 'INDEPENDENT CREATIVE STUDIO'} · {studio?.location || 'LAGOS & EVERYWHERE'}</p><h1>{(studio?.hero_title || 'Ideas into\nidentity.').split('\n').map((line, index) => <React.Fragment key={`${line}-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</h1><p className="hero-lede">{studio?.hero_subtitle || 'We shape brands, images and moving stories for people building something that matters.'}</p><div className="hero-actions"><Link className="button button-yellow" to="/portfolio">Explore our work <ArrowRight size={17} /></Link><Link className="quiet-link" to="/contact">Tell us what you're making <ArrowDownRight size={16} /></Link></div><div className="hero-services"><span>BRAND</span><i /><span>IMAGE</span><i /><span>MOTION</span></div></div>
        <div className="hero-visual" aria-label="GLYPH brand shapes"><div className="visual-frame"><div className="frame-top"><span>GLYPH / 001</span><span>CREATIVE STUDIO</span></div><img src={publicAsset('assets/glyph-shapes.png')} alt="GLYPH's bold geometric brand shapes in blue, yellow, orange, purple, and red" /><div className="frame-bottom"><b>Make your mark.</b><span>EST. FOR THE MAKERS</span></div></div><div className="hero-sticker">BRAVE<br />BY DESIGN <Sparkles size={18} /></div></div>
      </section>
      <section className="studio-pillars wrap" aria-label="How the studio works">
        <article><span>01 / IDENTITY</span><h2>Distinct by design.</h2><p>Clear, characterful brand identities made to feel like you.</p><Link to="/contact">Build a brand <ArrowRight size={14} /></Link></article>
        <article><span>02 / IMAGE</span><h2>Made to move you.</h2><p>Photography and visuals that give good ideas a point of view.</p><Link to="/portfolio">Explore the work <ArrowRight size={14} /></Link></article>
        <article><span>03 / MOTION</span><h2>Stories in motion.</h2><p>Thoughtful video and editing, shaped around the story.</p><Link to="/contact">Tell your story <ArrowRight size={14} /></Link></article>
      </section>
      <section className="marquee-band"><div className="wrap marquee"><span>IDENTITY</span><i>✳</i><span>DESIGN</span><i>✳</i><span>STORYTELLING</span><i>✳</i><span>IMAGE-MAKING</span><i>✳</i><span>IDENTITY</span></div></section>
      <section className="work-section wrap" id="work"><div className="section-head"><div><p className="kicker">01 / SELECTED WORK</p><h2>Made to be<br /><em>remembered.</em></h2></div><Link className="quiet-link" to="/portfolio">See the portfolio <ArrowRight size={16} /></Link></div>
        {loadError && <p className="notice-error">{loadError}</p>}
        {work.length ? <div className="work-grid">{work.map((item, index) => <WorkCard key={item.id} item={item} index={index} />)}</div> : <div className="work-empty"><span className="shape-spark">✳</span><h3>Fresh work is on its way.</h3><p>We’re getting our first stories ready to share. Have a project in mind? Let’s make something worth showing.</p><Link className="quiet-link" to="/contact">Start a conversation <ArrowRight size={16} /></Link></div>}
      </section>
      <section className="services-section" id="services"><div className="wrap services-layout"><div><p className="kicker">02 / WHAT WE DO</p><h2>Small studio.<br /><em>Wide lens.</em></h2><p className="section-copy">From the first sketch to the final frame, we bring clarity and character to every part of your story.</p><Link className="button button-outline" to="/contact">Let’s work together <ArrowRight size={16} /></Link></div><div className="service-list">{(studio?.services?.length ? studio.services : services).map((service, i) => <div className="service-row" key={service}><span>{String(i + 1).padStart(2, '0')}</span><b>{service}</b><ArrowRight size={17} /></div>)}</div></div><img className="service-shape" src={publicAsset('assets/glyph-shapes.png')} alt="" /></section>
      <section className="studio-note wrap" id="studio"><div className="note-symbol">G.</div><div><p className="kicker">03 / THE STUDIO</p><h2>Good ideas need<br />good <em>company.</em></h2><p>{studio?.about_text || 'GLYPH is an independent creative studio partnering with ambitious people to build thoughtful brands and vivid visual worlds.'}</p><Link className="quiet-link" to="/contact">A little about your project <ArrowRight size={16} /></Link></div><div className="note-aside"><span>THOUGHTFUL<br />BY NATURE.</span><b>✳</b><span>FEARLESS<br />IN EXECUTION.</span></div></section>
      <section className="closing-cta"><div className="wrap cta-inner"><p className="kicker">HAVE A GOOD ONE IN MIND?</p><h2>Let’s make it<br /><em>real.</em></h2><Link className="button button-dark" to="/contact">Start a project <ArrowRight size={17} /></Link><div className="cta-star">✳</div></div></section>
    </main>
    <SiteFooter />
  </div>
}

function WorkCard({ item, index }) {
  return <Link to={`/portfolio/${item.slug}`} className={`work-card work-card-${index % 3}`}><div className="work-cover" style={item.cover_url ? { backgroundImage: `url("${item.cover_url}")` } : undefined}><span className="cover-index">GL / {String(index + 1).padStart(2, '0')}</span>{!item.cover_url && <span className="cover-type">{item.service || 'SELECTED WORK'}</span>}<ArrowDownRight size={22} /></div><p className="work-service">{item.service || 'CREATIVE STUDIO'}</p><h3>{item.title}</h3><p>{item.summary}</p></Link>
}

function Portfolio() {
  const { studio, error: studioError } = usePublicStudio()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) { setItems([]); return }
    supabase.from('portfolio_items').select('id, slug, title, segment, service, summary, cover_path, featured').eq('published', true).order('featured', { ascending: false }).order('created_at', { ascending: false })
      .then(async ({ data, error: queryError }) => {
        if (queryError) { setError(queryError.message); return }
        const signed = await attachPortfolioCovers(data || [])
        if (signed.error) setError(signed.error.message)
        setItems(signed.data)
      })
  }, [])
  const groupedItems = items && portfolioSegments
    .map((segment) => ({ segment, projects: items.filter((item) => item.segment === segment) }))
    .filter((group) => group.projects.length)
  return <div className="public-site marketing-site"><SiteNav /><main className="wrap portfolio-page">{studioError && <p className="notice-error">{studioError}</p>}
    <p className="kicker">{studio?.studio_name || 'GLYPH'} / SELECTED WORK</p>
    <h1>Selected<br /><em>work.</em></h1>
    <p className="portfolio-lede">{studio?.about_text || 'Each project is a collaboration, a point of view, and a little piece of the world we want to see.'}</p>
    {error && <p className="notice-error">{error}</p>}
    {items === null ? <div className="work-empty">Gathering the work…</div> : items.length ? groupedItems.map(({ segment, projects }) => <section className="portfolio-segment" key={segment}>
      <header className="portfolio-segment-heading"><p className="kicker">PORTFOLIO / SEGMENT</p><h2>{segment}</h2></header>
      <div className="work-grid">{projects.map((item, index) => <WorkCard key={item.id} item={item} index={index} />)}</div>
    </section>) : <div className="work-empty"><span className="shape-spark">✳</span><h3>The gallery is getting ready.</h3><p>There are no published projects just yet. Check back soon or tell us what you would like to make.</p><Link className="button button-dark" to="/contact">Start a project <ArrowRight size={16} /></Link></div>}</main><SiteFooter /></div>
}

function PortfolioDetail() {
  const { slug } = useParams()
  const [item, setItem] = useState(null)
  const [assets, setAssets] = useState([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) { setReady(true); return }
    supabase.from('portfolio_items').select('id, title, segment, service, summary, cover_path').eq('slug', slug).eq('published', true).maybeSingle()
      .then(async ({ data, error }) => {
        if (error) { setError(error.message); setReady(true); return }
        if (data) {
          const signed = await attachPortfolioCovers([data])
          if (signed.error) setError(signed.error.message)
          else setItem(signed.data[0])
          const files = await attachPortfolioAssets(data.id)
          if (files.error) setError(files.error.message)
          else setAssets(files.data)
        }
        setReady(true)
      })
  }, [slug])
  if (!ready) return <div className="center-state">Loading case study…</div>
  if (!item) return <div className="public-site marketing-site"><SiteNav /><main className="wrap not-found">{error ? <p className="notice-error">{error}</p> : <><h1>Not found.</h1><p>This story may be private or no longer published.</p></>}<Link className="quiet-link" to="/portfolio"><ArrowLeft size={16} /> Back to the portfolio</Link></main><SiteFooter /></div>
  return <div className="public-site marketing-site"><SiteNav /><main className="wrap case-study"><Link to="/portfolio" className="quiet-link"><ArrowLeft size={16} /> All work</Link>
    <p className="kicker">{item.segment} / {item.service || 'SELECTED WORK'}</p>
    <h1>{item.title}</h1>
    {error && <p className="notice-error">{error}</p>}
    {assets.filter((asset) => asset.mime_type.startsWith('image/')).map((asset) => <img className="case-asset-image" key={asset.id} src={asset.url} alt={item.title} loading="lazy" />)}
    {item.cover_url && !assets.some((asset) => asset.storage_path === item.cover_path) && <div className="case-cover" style={{ backgroundImage: `url("${item.cover_url}")` }} />}
    <div className="case-copy"><p className="kicker">THE STORY</p><p>{item.summary}</p></div>
    {assets.filter((asset) => asset.mime_type === 'application/pdf').map((asset) => <a className="button button-soft" key={asset.id} href={asset.url} target="_blank" rel="noreferrer">{asset.file_name} <ExternalLink size={15} /></a>)}<Link className="button button-dark" to="/contact">Have a project in mind? <ArrowRight size={16} /></Link></main><SiteFooter /></div>
}

function Contact() {
  const { studio } = usePublicStudio()
  const { user, sendSignInLink } = useAuth()
  const navigate = useNavigate()
  const [sent, setSent] = useState(false)
  const [signInLinkPending, setSignInLinkPending] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (!supabase) { setError(supabaseConfigMessage); return }
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const email = String(values.email).trim().toLowerCase()
    setBusy(true)
    setError('')
    const { error: submitError } = await supabase.rpc('submit_inquiry', {
      inquiry_name: String(values.name).trim(),
      inquiry_email: email,
      inquiry_service: String(values.service),
      inquiry_message: String(values.message).trim(),
    })
    if (submitError) {
      setError(submitError.message)
      setBusy(false)
      return
    }
    if (user) {
      if (user.email?.toLowerCase() !== email || user.email?.toLowerCase() === studioOwnerEmail) {
        setSuccessMessage(user.email?.toLowerCase() === studioOwnerEmail
          ? 'Your request is saved in the Studio Requests inbox. The client can create their portal account using the email you entered.'
          : 'Your request is saved. Sign in with the email address you entered to connect it to your portal.')
        setSent(true)
        setBusy(false)
        return
      }
      const { error: claimError } = await supabase.rpc('claim_client_project_requests')
      if (claimError) {
        setSuccessMessage('Your request is saved, but portal setup did not finish. Open the client portal again to retry.')
        setError(claimError.message)
        setSent(true)
        setBusy(false)
        return
      }
      setBusy(false)
      navigate('/portal')
      return
    }
    const signInLink = await sendSignInLink({
      email,
      fullName: String(values.name).trim(),
      accountType: 'client',
      shouldCreateUser: true,
      redirectTo: `${window.location.origin}${appPath('/portal')}`,
    })
    if (signInLink.error) {
      setSuccessMessage('Your request is saved, but we could not send the secure portal sign-in link. The studio can still follow up using your email.')
      setError(signInLink.error.message)
    } else if (!signInLink.data.session) {
      setSignInLinkPending(true)
      setSuccessMessage('Your request is saved. Check your email for a secure sign-in link to open the client portal. No password is needed.')
    } else {
      const { error: claimError } = await supabase.rpc('claim_client_project_requests')
      if (claimError) {
        setSuccessMessage('Your request is saved, but portal setup did not finish. Sign in and open the portal to retry.')
        setError(claimError.message)
      } else {
        setBusy(false)
        navigate('/portal')
        return
      }
    }
    setSent(true)
    setBusy(false)
  }
  return <div className="public-site marketing-site"><SiteNav /><main className="wrap contact-page"><div className="contact-intro"><p className="kicker">LET’S GET INTO IT</p><h1>Tell us what<br />you’re <em>dreaming.</em></h1><p>Give {studio?.studio_name || 'the studio'} the short version. We’ll take it from there.</p><div className="contact-mark">✳</div></div><div className="contact-form panel">{sent ? <div className="form-success"><Check /><h2>{signInLinkPending ? 'Check your email.' : 'Request received.'}</h2><p>{successMessage}</p>{error && <p className="notice-error">{error}</p>}<Link className="button button-dark" to="/sign-in?returnTo=%2Fportal">Go to client portal sign-in <ArrowRight size={16} /></Link></div> : <form onSubmit={submit}><label>Your name<input name="name" required maxLength="120" autoComplete="name" /></label><label>Your email<input name="email" required type="email" maxLength="254" autoComplete="email" /></label><label>What are you looking for?<select name="service" defaultValue=""><option value="" disabled>Pick a starting point</option>{(studio?.services?.length ? studio.services : services).map((service) => <option key={service}>{service}</option>)}<option>Something else</option></select></label><label>A little about it<textarea name="message" required minLength="10" maxLength="5000" rows="5" /></label>{!user && <small className="muted-copy">We’ll email you a secure sign-in link so you can access the client portal—no password needed.</small>}{user && user.email?.toLowerCase() !== studioOwnerEmail && <p className="muted-copy">You’re signed in as {user.email}. Use that email address to connect this request to your client portal.</p>}{error && <p className="notice-error">{error}</p>}<button className="button button-dark button-wide" disabled={busy}>{busy ? 'Creating your request…' : user ? 'Send project request' : 'Send request & email portal link'} <Send size={16} /></button></form>}</div></main><SiteFooter /></div>
}

function AuthPage({ signup = false }) {
  const { signIn, signUp, sendSignInLink, resetPassword, updatePassword, recoveryPending, user, configured, configMessage } = useAuth()
  const location = useLocation()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [emailLinkMode, setEmailLinkMode] = useState(false)
  const navigate = useNavigate()
  const requestedPath = typeof location.state?.from === 'string' ? location.state.from : ''
  const queryReturnTo = new URLSearchParams(location.search).get('returnTo') || ''
  const requestedReturnPath = safeAuthReturnPath(requestedPath) ? requestedPath : queryReturnTo
  const invitationToken = isPortalInvitation(requestedReturnPath)
    ? new URLSearchParams(new URL(requestedReturnPath, window.location.origin).search).get('invite')
    : null
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState(invitationToken ? 'loading' : 'none')
  useEffect(() => {
    if (safeAuthReturnPath(requestedReturnPath)) {
      sessionStorage.setItem('glyph.auth.returnTo', requestedReturnPath)
    }
  }, [requestedReturnPath])
  useEffect(() => {
    let active = true
    if (!invitationToken || !supabase) {
      setInviteStatus('invalid')
      return () => { active = false }
    }
    supabase.rpc('get_client_invitation_email', { invitation_token: invitationToken })
      .then(({ data, error: invitationError }) => {
        if (!active) return
        if (invitationError) {
          setInviteStatus('invalid')
          setError(invitationError.message)
          return
        }
        if (typeof data !== 'string' || !data) {
          setInviteStatus('invalid')
          setError('This client invitation is invalid. Ask the studio to send a new invitation.')
          return
        }
        setInviteEmail(data)
        setInviteStatus('valid')
      })
    return () => { active = false }
  }, [invitationToken])
  const storedPath = sessionStorage.getItem('glyph.auth.returnTo') || ''
  const returnTo = safeAuthReturnPath(requestedReturnPath)
    ? requestedReturnPath
    : safeAuthReturnPath(storedPath) ? storedPath : '/studio'
  const isClientInvite = isPortalInvitation(returnTo)
  const isClientPortal = returnTo === '/portal' || returnTo.startsWith('/portal/')
  const authQuery = isClientInvite ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError('')
    setMessage('')
    const values = Object.fromEntries(new FormData(form))
    if (signup && (!isClientInvite || inviteStatus !== 'valid')) {
      setError('Client accounts can only be created from a valid project invitation.')
      setBusy(false)
      return
    }
    if (isClientInvite && String(values.email).toLowerCase() !== inviteEmail.toLowerCase()) {
      setError('Use the email address the studio invited.')
      setBusy(false)
      return
    }
    if (recoveryPending && values.password !== values.confirmPassword) {
      setError('The new passwords do not match.')
      setBusy(false)
      return
    }
    const result = recoveryPending
      ? await updatePassword(values.password)
      : resetMode
        ? await resetPassword(values.email)
        : emailLinkMode
          ? await sendSignInLink({
            email: values.email,
            accountType: isClientPortal ? 'client' : undefined,
            shouldCreateUser: isClientPortal,
            redirectTo: `${window.location.origin}${appPath(returnTo)}`,
          })
        : signup
        ? await signUp({
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          redirectTo: isClientInvite
            ? `${window.location.origin}${appPath('/sign-in')}?returnTo=${encodeURIComponent(returnTo)}`
            : undefined,
        })
        : await signIn({ email: values.email, password: values.password })
    setBusy(false)
    if (result.error) setError(result.error.message)
    else if (recoveryPending) {
      form.reset()
      navigate('/studio')
    }
    else if (resetMode) {
      setMessage('If an account exists for that email, a secure password-reset link is on its way.')
      form.reset()
    }
    else if (emailLinkMode) {
      setMessage('If an account exists for that email, a secure sign-in link is on its way. Check your inbox and spam folder.')
      form.reset()
    }
    else if (signup && !result.data.session) {
      setMessage('Check your email to confirm your account, then sign in.')
      form.reset()
    }
    else {
      sessionStorage.removeItem('glyph.auth.returnTo')
      navigate(returnTo)
    }
  }
  if (user && !recoveryPending) return <Navigate to={returnTo} replace />
  const title = recoveryPending ? 'Choose a new password.' : resetMode ? 'Reset your password.' : emailLinkMode ? 'Get a secure sign-in link.' : signup ? isClientInvite ? 'Join the project.' : 'Make room.' : 'Welcome back.'
  const description = recoveryPending
    ? 'Choose a new password for your GLYPH studio account.'
    : resetMode ? 'We’ll email you a secure link to choose a new password.'
      : emailLinkMode ? 'Enter your email and we’ll send you a one-time sign-in link. No password needed.'
      : signup ? isClientInvite
        ? 'Create a client login using the same email address this invitation was sent to.'
        : 'Create your private studio workspace.'
        : isClientPortal ? 'Sign in with your password or request a secure link sent to your email.'
          : 'Sign in to your creative studio.'
  if (signup && !isClientInvite) return <Navigate to="/" replace />
  return <div className="auth-layout"><div className="auth-brand"><Brand /></div><main className="auth-panel"><p className="kicker">{isClientInvite || isClientPortal ? 'GLYPH / CLIENT ACCESS' : 'GLYPH / STUDIO ACCESS'}</p><h1>{title}</h1><p>{description}</p>{isClientInvite && inviteStatus === 'loading' && <p className="loading-copy">Checking your private invitation…</p>}<form onSubmit={submit}>{signup && !resetMode && !recoveryPending && <label>Your name<input name="fullName" required minLength="2" autoComplete="name" /></label>}{!recoveryPending && !resetMode && <label>Email<input name="email" required type="email" autoComplete="email" value={isClientInvite && inviteStatus === 'valid' ? inviteEmail : undefined} readOnly={isClientInvite} /></label>}{resetMode && <label>Email<input name="email" required type="email" autoComplete="email" /></label>}{!resetMode && !emailLinkMode && <label>{recoveryPending ? 'New password' : 'Password'}<input name="password" required type="password" minLength={signup || recoveryPending ? 8 : undefined} autoComplete={signup || recoveryPending ? 'new-password' : 'current-password'} /></label>}{recoveryPending && <label>Confirm new password<input name="confirmPassword" required type="password" minLength="8" autoComplete="new-password" /></label>}{error && <p className="notice-error">{error}</p>}{message && <p className="notice-success">{message}</p>}{!configured && <p className="notice-error">{configMessage}</p>}<button className="button button-dark button-wide" disabled={busy || !configured || (isClientInvite && inviteStatus !== 'valid')}>{busy ? 'One moment…' : recoveryPending ? 'Save new password' : resetMode ? 'Send reset link' : emailLinkMode ? 'Email me a sign-in link' : signup ? 'Create client account' : 'Sign in'} <ArrowRight size={16} /></button></form>{!signup && !recoveryPending && <><button className="quiet-link auth-reset" onClick={() => { setResetMode((current) => !current); setEmailLinkMode(false); setError(''); setMessage('') }}>{resetMode ? 'Back to sign in' : 'Forgot your password?'}</button><button className="quiet-link auth-reset" onClick={() => { setEmailLinkMode((current) => !current); setResetMode(false); setError(''); setMessage('') }}>{emailLinkMode ? 'Back to password sign in' : 'Email me a secure sign-in link'}</button></>}{isClientInvite && <p className="auth-switch">{signup ? 'Already have a client login?' : 'New to the client portal?'} <Link to={`${signup ? '/sign-in' : '/create-account'}${authQuery}`}>{signup ? 'Sign in' : 'Create a client login'}</Link></p>}<Link className="quiet-link auth-back" to="/"><ArrowLeft size={15} /> Back to the public site</Link></main></div>
}

function isPortalInvitation(path) {
  if (!safeAuthReturnPath(path)) return false
  const parsed = new URL(path, window.location.origin)
  return parsed.pathname === '/portal' && Boolean(new URLSearchParams(parsed.search).get('invite'))
}

function StudioShell() {
  const { profile, user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [newRequestCount, setNewRequestCount] = useState(0)
  const unreadMessages = useUnreadProjectMessages(user?.id, setNotificationError)
  const location = useLocation()
  const [isMobileStudioApp] = useState(() => {
    if (new URLSearchParams(window.location.search).get('app') === 'mobile') {
      window.sessionStorage.setItem('glyph-studio-mobile-app', 'true')
      return true
    }
    return window.sessionStorage.getItem('glyph-studio-mobile-app') === 'true'
  })
  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let active = true
    let channel
    async function loadRequestCount(workspaceId) {
      const { count, error } = await supabase.from('inquiries')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'new')
      if (!active) return
      if (error) setNotificationError(error.message)
      else setNewRequestCount(count || 0)
    }
    supabase.from('members').select('workspace_id').eq('user_id', user.id).eq('role', 'owner').maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setNotificationError(error.message)
          return
        }
        if (!data?.workspace_id) return
        loadRequestCount(data.workspace_id)
        channel = supabase.channel(`project-requests:${data.workspace_id}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'inquiries',
            filter: `workspace_id=eq.${data.workspace_id}`,
          }, () => loadRequestCount(data.workspace_id))
          .subscribe()
      })
    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [user?.id])
  const tabs = [
    ['/studio', 'Overview', Sparkles], ['/studio/search', 'Search', Search], ['/studio/clients', 'Clients', Users], ['/studio/projects', 'Projects', FolderKanban],
    ['/studio/portfolio', 'Portfolio', Palette], ['/studio/calendar', 'Calendar', CalendarDays], ['/studio/requests', 'Requests', MessageCircle], ['/studio/finance', 'Invoices', FileText], ['/studio/settings', 'Settings', Settings2],
  ]
  const mobileTabs = [
    ['/studio', 'Studio', Sparkles],
    ['/studio/projects', 'Projects', FolderKanban],
    ['/studio/clients', 'Clients', Users],
    ['/studio/finance', 'Finance', FileText],
    ['/studio/calendar', 'Calendar', CalendarDays],
  ]
  const mobileTools = [
    ['/studio/search', 'Search your studio', Search],
    ['/studio/requests', 'Project requests', MessageCircle],
    ['/studio/portfolio', 'Portfolio', Palette],
    ['/studio/settings', 'Settings', Settings2],
  ]
  const mobileTabActive = (path) => path === '/studio'
    ? location.pathname === path
    : location.pathname === path || location.pathname.startsWith(`${path}/`)
  const avatarInitial = profile?.full_name?.trim().charAt(0).toUpperCase()
    || user?.email?.charAt(0).toUpperCase()
    || 'G'

  return (
    <UnreadProjectMessagesContext.Provider value={{ counts: unreadMessages.counts, markRead: unreadMessages.markRead }}>
      <div className={`studio-shell${isMobileStudioApp ? ' mobile-app-mode' : ''}`}>
        {isMobileStudioApp && (
          <>
            <header className="mobile-studio-header">
              <div className="mobile-studio-brand">
                <img src={publicAsset('assets/glyph-logo.jpg')} alt="" />
                <span><b>GLYPH</b><small>CREATIVE STUDIO</small></span>
              </div>
              <button
                className="mobile-studio-more-button"
                aria-label={moreOpen ? 'Close studio tools' : 'Open studio tools'}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                {moreOpen ? <X size={19} /> : <span>{avatarInitial}</span>}
              </button>
            </header>
            {moreOpen && (
              <>
                <button
                  className="mobile-studio-more-scrim"
                  aria-label="Close studio tools"
                  onClick={() => setMoreOpen(false)}
                />
                <section className="mobile-studio-tools" aria-label="More studio tools">
                  <p className="kicker">YOUR WORKSPACE</p>
                  {mobileTools.map(([to, label, Icon]) => (
                    <Link key={to} to={to} onClick={() => setMoreOpen(false)}>
                      <Icon size={17} /><span>{label}</span><ArrowRight size={15} />
                    </Link>
                  ))}
                  <button onClick={signOut}><LogOut size={17} /><span>Sign out</span></button>
                </section>
              </>
            )}
            <nav className="mobile-studio-tabbar" aria-label="Studio navigation">
              {mobileTabs.map(([to, label, Icon]) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={mobileTabActive(to) ? 'mobile-studio-tab active' : 'mobile-studio-tab'}
                  aria-current={mobileTabActive(to) ? 'page' : undefined}
                >
                  <Icon size={19} strokeWidth={mobileTabActive(to) ? 2 : 1.7} />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </>
        )}
        <aside className={menuOpen ? 'studio-sidebar sidebar-open' : 'studio-sidebar'}>
          <div className="sidebar-brand"><Brand /><button className="mobile-toggle" onClick={() => setMenuOpen(false)}><X /></button></div>
          <p className="kicker sidebar-label">YOUR WORKSPACE</p>
          <nav>{tabs.map(([to, label, Icon]) => <Link onClick={() => setMenuOpen(false)} className={`side-link ${location.pathname === to ? 'side-active' : ''}`} key={to} to={to}><Icon size={17} /><span>{label}</span>{label === 'Projects' && unreadMessages.total > 0 && <small className="unread-badge" aria-label={`${unreadMessages.total} unread project messages`}>{unreadMessages.total > 99 ? '99+' : unreadMessages.total}</small>}{label === 'Requests' && newRequestCount > 0 && <small className="unread-badge" aria-label={`${newRequestCount} new project requests`}>{newRequestCount > 99 ? '99+' : newRequestCount}</small>}</Link>)}</nav>
          <div className="sidebar-bottom">{!isMobileStudioApp && <Link className="public-link" to="/"><ExternalLink size={15} /> View public portfolio</Link>}<div className="account-row"><CircleUserRound size={21} /><span><b>{profile?.full_name || user?.email?.split('@')[0] || 'Studio owner'}</b><small>{user?.email}</small></span><button aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button></div></div>
        </aside>
        <button className="studio-menu mobile-toggle" onClick={() => setMenuOpen(true)} aria-label="Open studio navigation"><Menu /></button>
        <section className="studio-content">
          <header className="studio-topbar">
            <div><span className="studio-topbar-label">GLYPH / WORKSPACE</span><b>{profile?.full_name ? `Welcome back, ${profile.full_name.split(' ')[0]}` : 'Your creative workspace'}</b></div>
            <div className="studio-topbar-actions"><Link to="/studio/search" aria-label="Search clients, projects, notes and tasks"><Search size={17} /><span>Search your studio…</span><kbd>⌘ K</kbd></Link>{!isMobileStudioApp && <Link className="studio-topbar-public" to="/"><ExternalLink size={15} /> View portfolio</Link>}</div>
          </header>
          {notificationError && <p className="notice-error">{notificationError}</p>}
          <Routes><Route index element={<StudioOverview />} /><Route path="search" element={<StudioSearch />} /><Route path="requests" element={<ProjectRequests />} /><Route path="clients" element={<Clients />} /><Route path="clients/:id" element={<ClientDetail />} /><Route path="projects" element={<Projects />} /><Route path="projects/:id" element={<ProjectRoom />} /><Route path="portfolio" element={<PortfolioAdmin />} /><Route path="calendar" element={<ContentCalendar />} /><Route path="finance" element={<Finance />} /><Route path="settings" element={<StudioSettings />} /><Route path="*" element={<Navigate to="/studio" replace />} /></Routes>
        </section>
      </div>
    </UnreadProjectMessagesContext.Provider>
  )
}

function StudioAccessRoute() {
  const { user } = useAuth()
  const [authorized, setAuthorized] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (!supabase || !user?.id) {
      setAuthorized(false)
      return () => { active = false }
    }
    supabase.from('members')
      .select('role, workspaces!inner(owner_id)')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .eq('workspaces.owner_id', user.id)
      .then(({ data, error: checkError }) => {
        if (!active) return
        if (checkError) {
          setError(checkError.message)
          setAuthorized(false)
          return
        }
        setAuthorized(
          user.email?.toLowerCase() === studioOwnerEmail
          && (data || []).some((membership) => membership.role === 'owner'),
        )
      })
    return () => { active = false }
  }, [user?.email, user?.id])
  if (authorized === null) return <main className="auth-loading"><span className="eyebrow">Checking studio access</span><h1>One moment…</h1></main>
  if (error) return <main className="auth-loading"><p className="notice-error">Could not verify studio access: {error}</p><Link className="quiet-link" to="/portal">Continue to the client portal</Link></main>
  if (!authorized) return <Navigate to="/portal" replace />
  return <StudioShell />
}

function StudioSearch() {
  const { workspace, error, setError } = useStudioWorkspace()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  async function search(event) {
    event.preventDefault()
    if (!supabase || !workspace) return
    const term = query.trim()
    if (!term) {
      setResults([])
      setError('')
      return
    }
    setSearching(true)
    setError('')
    const pattern = `%${term.slice(0, 100)}%`
    const [clients, projects, tasks, notes] = await Promise.all([
      supabase.from('clients').select('id, name, company, email').eq('workspace_id', workspace.id).ilike('name', pattern).limit(10),
      supabase.from('projects').select('id, name, service, status').eq('workspace_id', workspace.id).ilike('name', pattern).limit(10),
      supabase.from('project_tasks').select('id, project_id, title, status, projects!inner(name)').eq('workspace_id', workspace.id).ilike('title', pattern).limit(10),
      supabase.from('project_notes').select('id, project_id, title, body, kind, projects!inner(name)').eq('workspace_id', workspace.id).ilike('body', pattern).limit(10),
    ])
    setSearching(false)
    const failed = [clients, projects, tasks, notes].find((result) => result.error)
    if (failed?.error) {
      setError(failed.error.message)
      setResults(null)
      return
    }
    setResults([
      ...(clients.data || []).map((item) => ({ id: item.id, kind: 'Client', title: item.name, detail: item.company || item.email || 'Client record', href: `/studio/clients/${item.id}` })),
      ...(projects.data || []).map((item) => ({ id: item.id, kind: 'Project', title: item.name, detail: `${item.service || 'Creative project'} · ${item.status.replaceAll('_', ' ')}`, href: `/studio/projects/${item.id}` })),
      ...(tasks.data || []).map((item) => ({ id: item.id, kind: 'Task', title: item.title, detail: `${item.projects.name} · ${item.status.replaceAll('_', ' ')}`, href: `/studio/projects/${item.project_id}` })),
      ...(notes.data || []).map((item) => ({ id: item.id, kind: item.kind, title: item.title || item.body.slice(0, 90), detail: item.projects.name, href: `/studio/projects/${item.project_id}` })),
    ])
  }

  return <main className="studio-page">
    <StudioPageHeader kicker="FIND YOUR WORK / SEARCH" title="Find the<br />right detail." />
    <form className="studio-search-form" onSubmit={search}>
      <Search size={18} />
      <input aria-label="Search clients, projects, notes and tasks" value={query} onChange={(event) => setQuery(event.target.value)} maxLength="100" placeholder="Search clients, projects, notes and tasks…" />
      <button className="button button-dark" disabled={searching || !workspace}>{searching ? 'Searching…' : 'Search'}</button>
    </form>
    {error && <p className="notice-error">{error}</p>}
    {results && <section className="studio-search-results" aria-live="polite">
      <p className="kicker">{results.length} RESULT{results.length === 1 ? '' : 'S'}</p>
      {results.length ? results.map((result) => <Link className="studio-search-result" to={result.href} key={`${result.kind}-${result.id}`}>
        <span className="note-kind">{result.kind}</span><b>{result.title}</b><small>{result.detail}</small><ArrowRight size={16} />
      </Link>) : <p className="empty-copy">No matches found in this workspace.</p>}
    </section>}
  </main>
}

function ProjectRequests() {
  const { workspace, error, setError } = useStudioWorkspace()
  const navigate = useNavigate()
  const [requests, setRequests] = useState(null)
  const [updatingId, setUpdatingId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    supabase.from('inquiries')
      .select('id, name, email, service, message, status, created_at, client_id, project_id')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message)
        else setRequests(data || [])
      })
  }, [workspace?.id, setError])

  async function updateStatus(request, status, openChat = false) {
    if (!supabase) return
    setUpdatingId(request.id)
    const { error: updateError } = await supabase.rpc('set_project_request_status', {
      target_request: request.id,
      new_status: status,
    })
    setUpdatingId('')
    if (updateError) {
      setError(updateError.message)
      return
    }
    const { data: updatedRequest, error: fetchError } = await supabase.from('inquiries')
      .select('project_id, client_id')
      .eq('id', request.id)
      .single()
    if (fetchError) {
      setError(fetchError.message)
      return
    }
    const nextRequest = { ...request, status, project_id: updatedRequest.project_id, client_id: updatedRequest.client_id }
    setRequests((current) => current.map((entry) => entry.id === request.id ? nextRequest : entry))
    if (openChat && nextRequest.project_id) navigate(`/studio/projects/${nextRequest.project_id}?tab=conversation`)
  }

  async function deleteRequest(request) {
    if (!supabase || !workspace || !window.confirm(`Delete the project request from ${request.name}?${request.project_id ? ' The linked project and its conversations will be kept.' : ''}`)) return
    setDeletingId(request.id)
    const { data, error: deleteError } = await supabase.from('inquiries').delete()
      .eq('id', request.id).eq('workspace_id', workspace.id).select('id')
    setDeletingId('')
    if (deleteError) setError(deleteError.message)
    else if (!data?.length) setError('Request was not deleted. Refresh the page and check that you still have access to this workspace.')
    else setRequests((current) => (current || []).filter((entry) => entry.id !== request.id))
  }

  const newRequests = requests?.filter((request) => request.status === 'new').length || 0
  return <main className="studio-page">
    <StudioPageHeader kicker="YOUR STUDIO / INCOMING WORK" title="Every good thing<br />starts somewhere." />
    {error && <p className="notice-error">{error}</p>}
    <div className="studio-section-heading"><div><p className="kicker">{newRequests} NEW REQUEST{newRequests === 1 ? '' : 'S'}</p><h2>Project requests</h2></div></div>
    {requests === null ? <p className="loading-copy">Loading project requests…</p> : requests.length ? <div className="record-list">{requests.map((request) => <article className="record-row" key={request.id}>
      <span className="project-index index-1"><MessageCircle size={17} /></span>
      <div className="record-main"><b>{request.name} · {request.service || 'Project inquiry'}</b><span>{request.email} · {new Date(request.created_at).toLocaleDateString()}</span><p>{request.message}</p></div>
      <label className="calendar-status">Request status<select aria-label={`Status for request from ${request.name}`} value={request.status} disabled={updatingId === request.id} onChange={(event) => updateStatus(request, event.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></label>
      {request.status === 'accepted' && request.project_id && <button className="button button-dark" onClick={() => navigate(`/studio/projects/${request.project_id}?tab=conversation`)}><MessageCircle size={15} /> Open chat</button>}
      {request.status === 'accepted' && !request.project_id && <button className="button button-dark" disabled={updatingId === request.id} onClick={() => updateStatus(request, 'accepted', true)}>{updatingId === request.id ? 'Opening…' : 'Set up chat'} <ArrowRight size={15} /></button>}
      {request.status !== 'accepted' && request.status !== 'declined' && <button className="button button-dark" disabled={updatingId === request.id} onClick={() => updateStatus(request, 'accepted', true)}>{updatingId === request.id ? 'Accepting…' : 'Accept & open chat'} <ArrowRight size={15} /></button>}
      <button className="button button-danger" disabled={deletingId === request.id || updatingId === request.id} onClick={() => deleteRequest(request)} aria-label={`Delete request from ${request.name}`}>{deletingId === request.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button>
    </article>)}</div> : <div className="studio-empty"><MessageCircle /><h3>No project requests yet.</h3><p>Requests from the public portfolio will appear here. Once someone submits the form, they’ll also get a client portal project to message you about.</p></div>}
  </main>
}

function useStudioWorkspace() {
  const { user } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [error, setError] = useState('')
  const reportError = useCallback((message) => setError(message), [])
  useEffect(() => {
    if (!supabase || !user?.id) return
    supabase.from('members').select('workspace_id, workspaces(id, studio_name, slug, contact_email, brand_color, tagline, location, hero_title, hero_subtitle, about_text, services, enabled_social_platforms, payment_bank_name, payment_account_name, payment_account_number, payment_reference_note, payment_note)').eq('user_id', user.id).eq('role', 'owner').maybeSingle()
      .then(({ data, error: queryError }) => { if (queryError) reportError(queryError.message); else setWorkspace(data?.workspaces || null) })
  }, [user?.id, reportError])
  return { user, workspace, setWorkspace, error, setError: reportError }
}

function StudioOverview() {
  const { user, workspace, error, setError } = useStudioWorkspace()
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      supabase.from('projects').select('id, name, status, due_date').eq('workspace_id', workspace.id).order('updated_at', { ascending: false }).limit(5),
    ]).then(([clientResult, projectResult]) => {
      if (clientResult.error) setError(clientResult.error.message)
      if (projectResult.error) setError(projectResult.error.message)
      setClients(clientResult.count ? Array(clientResult.count).fill(null) : [])
      setProjects(projectResult.data || [])
    })
  }, [workspace?.id, setError])
  return <main className="studio-page"><div className="studio-heading"><div><p className="kicker">YOUR STUDIO / TODAY</p><h1>Make good<br /><em>things happen.</em></h1><p>One considered place for the people and projects behind the work.</p></div><span className="dashboard-spark">✳</span></div>{error && <p className="notice-error">{error}</p>}{!isSupabaseConfigured && <p className="notice-error">{supabaseConfigMessage}</p>}<div className="dashboard-stats"><div><span>CLIENTS</span><b>{clients.length}</b></div><div><span>ACTIVE PROJECTS</span><b>{projects.filter((item) => !['complete', 'archived'].includes(item.status)).length}</b></div><div><span>STUDIO</span><b className="stat-studio">{workspace?.studio_name || 'GLYPH'}</b></div></div><div className="studio-section-heading"><div><p className="kicker">IN MOTION</p><h2>Recent projects</h2></div><Link className="quiet-link" to="/studio/projects">All projects <ArrowRight size={15} /></Link></div>{projects.length ? <div className="studio-project-list">{projects.map((project, index) => <Link key={project.id} to={`/studio/projects/${project.id}`} className="studio-project-row"><span className={`project-index index-${index % 3}`}>0{index + 1}</span><span><b>{project.name}</b><small>{project.status.replaceAll('_', ' ')}{project.due_date ? ` · Due ${project.due_date}` : ''}</small></span><ArrowRight size={17} /></Link>)}</div> : <div className="studio-empty"><FolderKanban /><h3>Your first project starts here.</h3><p>Add a client, create a project, and keep the details together.</p><Link className="button button-dark" to="/studio/projects">Create a project <ArrowRight size={15} /></Link></div>}<QuickSetup /></main>
}

function QuickSetup() {
  return <section className="quick-setup"><p className="kicker">BUILT FOR YOUR WAY OF WORKING</p><div className="quick-grid"><div><Link2 /><b>Keep Drive in the loop</b><span>Add Google Drive links to a project or deliverable.</span></div><div><MessageCircle /><b>Keep decisions close</b><span>Record WhatsApp calls and client decisions as project notes.</span></div><div><LockKeyhole /><b>Share with intention</b><span>Client project access is private and explicitly granted.</span></div></div></section>
}

function Clients() {
  const { user, workspace, error, setError } = useStudioWorkspace()
  const [items, setItems] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    supabase.from('clients').select('id, name, email, phone, company, notes, created_at').eq('workspace_id', workspace.id).order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => { if (queryError) setError(queryError.message); else setItems(data || []) })
  }, [workspace?.id, setError])
  async function save(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user) return
    setSaving(true)
    setInviteLink('')
    setInviteEmail('')
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const email = String(form.email || '').trim().toLowerCase()
    const projectName = String(form.project_name || '').trim()
    if (form.invite_portal === 'on' && !email) {
      setError('Add the client’s email address before creating a portal invitation.')
      setSaving(false)
      return
    }
    if (form.create_project === 'on' && !projectName) {
      setError('Enter a project name to create the client’s first shared project.')
      setSaving(false)
      return
    }
    const result = await supabase.from('clients').insert({
      workspace_id: workspace.id,
      name: String(form.name).trim(),
      email: email || null,
      phone: String(form.phone || '').trim() || null,
      company: String(form.company || '').trim() || null,
      notes: String(form.notes || '').trim(),
    }).select().single()
    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }
    setItems((current) => [result.data, ...(current || [])])
    const followUpErrors = []
    if (form.create_project === 'on') {
      const project = await supabase.from('projects').insert({
        workspace_id: workspace.id,
        client_id: result.data.id,
        name: projectName,
        service: String(form.project_service || ''),
        brief: String(form.project_brief || '').trim(),
        share_with_client: true,
      })
      if (project.error) followUpErrors.push(`The client was added, but the shared project could not be created: ${project.error.message}`)
    }
    if (form.invite_portal === 'on') {
      const invitation = await supabase.from('invitations').insert({
        workspace_id: workspace.id,
        client_id: result.data.id,
        email,
        invited_by: user.id,
      }).select('token').single()
      if (invitation.error) followUpErrors.push(`The client was added, but the portal invitation could not be created: ${invitation.error.message}`)
      else {
        setInviteEmail(email)
        setInviteLink(`${window.location.origin}${appPath('/portal')}?invite=${invitation.data.token}`)
      }
    }
    setSaving(false)
    setEditing(false)
    setError(followUpErrors.join(' '))
  }
  async function invite(client) {
    if (!supabase || !workspace || !user || !client.email) return
    const result = await supabase.from('invitations').insert({ workspace_id: workspace.id, client_id: client.id, email: client.email.toLowerCase(), invited_by: user.id }).select('token').single()
    if (result.error) setError(result.error.message)
    else {
      setInviteEmail(client.email)
      setInviteLink(`${window.location.origin}${appPath('/portal')}?invite=${result.data.token}`)
    }
  }
  async function deleteClient(client) {
    if (!supabase || !workspace || !window.confirm(`Delete client "${client.name}"? Their portal access and invitations will be removed. Linked projects and invoices will remain, but will be unlinked from this client.`)) return
    setDeletingId(client.id)
    const { data, error: deleteError } = await supabase.from('clients').delete()
      .eq('id', client.id).eq('workspace_id', workspace.id).select('id')
    setDeletingId('')
    if (deleteError) setError(deleteError.message)
    else if (!data?.length) setError('Client was not deleted. Refresh the page and check that you still have access to this workspace.')
    else setItems((current) => (current || []).filter((entry) => entry.id !== client.id))
  }
  return <main className="studio-page"><StudioPageHeader kicker="PEOPLE / CLIENTS" title="The people<br />behind the work." action={<button className="button button-yellow" onClick={() => setEditing(true)} disabled={!workspace}><Plus size={16} /> Add a client</button>} />{error && <p className="notice-error">{error}</p>}{inviteLink && <div className="invite-share"><b>Client portal invitation</b><p>Send this private link to {inviteEmail}. They can create an account with that email to access shared projects and invoices.</p><input value={inviteLink} readOnly onFocus={(event) => event.target.select()} /></div>}{items === null ? <p className="loading-copy">Loading your clients…</p> : items.length ? <div className="record-list">{items.map((client) => <article className="record-row" key={client.id}><div className="record-avatar">{client.name.slice(0, 1).toUpperCase()}</div><div className="record-main"><b>{client.name}</b><span>{client.company || 'Independent client'}{client.email ? ` · ${client.email}` : ''}</span>{client.notes && <small>{client.notes}</small>}</div>{client.email && <button className="button button-soft" onClick={() => invite(client)}>Invite</button>}<Link className="quiet-link" to={`/studio/clients/${client.id}`}>Open <ArrowRight size={15} /></Link><button className="button button-danger" disabled={deletingId === client.id} onClick={() => deleteClient(client)} aria-label={`Delete ${client.name}`}>{deletingId === client.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button></article>)}</div> : <EmptyRecord title="No client records yet" text="Create a client record to link together their projects, discussions, and invoices." onCreate={() => setEditing(true)} />}{editing && <Modal title="Onboard a client" onClose={() => setEditing(false)}><form onSubmit={save}><label>Client name<input name="name" required maxLength="160" /></label><div className="form-split"><label>Email<input name="email" type="email" maxLength="254" /></label><label>Phone<input name="phone" type="tel" maxLength="40" /></label></div><label>Company<input name="company" maxLength="160" /></label><label>Studio notes<textarea name="notes" rows="3" maxLength="5000" /></label><section className="client-onboarding-options"><label className="check-label"><input name="invite_portal" type="checkbox" /> Create a client portal invitation</label><small>They can sign up using this email to access shared projects, conversations, and invoices.</small><label className="check-label"><input name="create_project" type="checkbox" /> Create and share their first project</label><label>Project name<input name="project_name" maxLength="180" placeholder="e.g. Brand identity refresh" /></label><label>Service<select name="project_service" defaultValue=""><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label><label>Project brief<textarea name="project_brief" rows="3" maxLength="10000" placeholder="The goal, scope, and what success looks like…" /></label></section><button className="button button-dark" disabled={saving}>{saving ? 'Setting up…' : 'Save client'} <ArrowRight size={15} /></button></form></Modal>}</main>
}

function ClientDetail() {
  const { id } = useParams()
  const { workspace, error, setError } = useStudioWorkspace()
  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [invoices, setInvoices] = useState([])
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    Promise.all([
      supabase.from('clients').select('*').eq('id', id).eq('workspace_id', workspace.id).maybeSingle(),
      supabase.from('projects').select('id, name, service, status, due_date').eq('client_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, number, amount, currency, status, due_date, payments(amount, status, paid_at, receipts(receipt_number, issued_at))').eq('client_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
    ]).then(([clientResult, projectResult, invoiceResult]) => {
      if (clientResult.error) setError(clientResult.error.message)
      if (projectResult.error) setError(projectResult.error.message)
      if (invoiceResult.error) setError(invoiceResult.error.message)
      setClient(clientResult.data)
      setProjects(projectResult.data || [])
      setInvoices(invoiceResult.data || [])
    })
  }, [workspace?.id, id, setError])
  if (!client) return <main className="studio-page"><Link to="/studio/clients" className="quiet-link"><ArrowLeft size={15} /> Clients</Link>{error ? <p className="notice-error">{error}</p> : <p className="loading-copy">Loading client record…</p>}</main>
  return <main className="studio-page"><Link to="/studio/clients" className="quiet-link"><ArrowLeft size={15} /> All clients</Link><div className="client-profile-head"><span className="record-avatar">{client.name.slice(0, 1).toUpperCase()}</span><div><p className="kicker">CLIENT / CONTACT RECORD</p><h1>{client.name}</h1><p>{client.company || 'Independent client'}{client.email ? ` · ${client.email}` : ''}{client.phone ? ` · ${client.phone}` : ''}</p></div></div>{client.notes && <section className="room-brief"><p className="kicker">STUDIO NOTES</p><p>{client.notes}</p></section>}<div className="studio-section-heading"><div><p className="kicker">CLIENT WORK</p><h2>Projects</h2></div><Link className="quiet-link" to="/studio/projects">Create project <ArrowRight size={15} /></Link></div>{projects.length ? <div className="record-list">{projects.map((project, index) => <Link className="record-row project-record" key={project.id} to={`/studio/projects/${project.id}`}><span className={`project-index index-${index % 3}`}>0{index + 1}</span><div className="record-main"><b>{project.name}</b><span>{project.clients?.name || 'No client linked'} · {project.service || 'Creative project'}</span><small>{project.status.replaceAll('_', ' ')}{project.due_date ? ` · Due ${project.due_date}` : ''}</small></div><ArrowRight size={16} /></Link>)}</div> : <div className="studio-empty"><FolderKanban /><h3>No projects for this client yet.</h3><p>Create a project and link it to this client record.</p><Link className="button button-dark" to="/studio/projects">Open projects <ArrowRight size={15} /></Link></div>}<div className="studio-section-heading"><div><p className="kicker">CLIENT FINANCE</p><h2>Invoices & receipts</h2></div><Link className="quiet-link" to="/studio/finance">Finance <ArrowRight size={15} /></Link></div>{invoices.length ? <div className="record-list">{invoices.map((invoice) => <article className="record-row" key={invoice.id}><FileText /><div className="record-main"><b>Invoice #{invoice.number}</b><span>{money(Number(invoice.amount))} · {invoice.status}</span>{asRows(invoice.payments).flatMap((payment) => asRows(payment.receipts)).map((receipt) => <small key={receipt.receipt_number}>Receipt {receipt.receipt_number} · {new Date(receipt.issued_at).toLocaleDateString()}</small>)}</div></article>)}</div> : <p className="empty-copy">No invoices have been created for this client yet.</p>}</main>
}

function Projects() {
  const { user, workspace, error, setError } = useStudioWorkspace()
  const [items, setItems] = useState(null)
  const [clients, setClients] = useState([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    Promise.all([
      supabase.from('projects').select('id, name, service, status, due_date, clients(name)').eq('workspace_id', workspace.id).order('updated_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('workspace_id', workspace.id).order('name'),
    ]).then(([projectResult, clientResult]) => {
      if (projectResult.error) setError(projectResult.error.message)
      if (clientResult.error) setError(clientResult.error.message)
      setItems(projectResult.data || [])
      setClients(clientResult.data || [])
    })
  }, [workspace?.id, setError])
  async function save(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user) return
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const result = await supabase.from('projects').insert({ workspace_id: workspace.id, client_id: form.client_id || null, name: String(form.name).trim(), service: String(form.service), brief: String(form.brief || '').trim(), due_date: form.due_date || null, share_with_client: form.share_with_client === 'on' }).select('id, name, service, status, due_date, clients(name)').single()
    setSaving(false)
    if (result.error) setError(result.error.message)
    else {
      setItems((current) => [result.data, ...(current || [])])
      const activity = await supabase.from('activity_events').insert({ workspace_id: workspace.id, project_id: result.data.id, actor_id: user.id, event_type: 'project_created', summary: `Created project ${result.data.name}` })
      if (activity.error) setError(activity.error.message)
      setEditing(false)
    }
  }
  async function deleteProject(project) {
    if (!supabase || !workspace || !window.confirm(`Delete project "${project.name}"? Its tasks, notes, links, messages, and feedback will be deleted. Linked invoices, expenses, and portfolio items will remain without this project link.`)) return
    setDeletingId(project.id)
    const { data, error: deleteError } = await supabase.from('projects').delete()
      .eq('id', project.id).eq('workspace_id', workspace.id).select('id')
    setDeletingId('')
    if (deleteError) setError(deleteError.message)
    else if (!data?.length) setError('Project was not deleted. Refresh the page and check that you still have access to this workspace.')
    else setItems((current) => (current || []).filter((entry) => entry.id !== project.id))
  }
  return <main className="studio-page"><StudioPageHeader kicker="THE WORK / PROJECTS" title="Make space<br />for the work." action={<button className="button button-yellow" disabled={!workspace} onClick={() => setEditing(true)}><Plus size={16} /> New project</button>} />{error && <p className="notice-error">{error}</p>}{items === null ? <p className="loading-copy">Loading projects…</p> : items.length ? <div className="record-list">{items.map((project, index) => <article className="record-row project-record" key={project.id}><Link className="project-row-main" to={`/studio/projects/${project.id}`}><span className={`project-index index-${index % 3}`}>0{index + 1}</span><span className="record-main"><b>{project.name}</b><span>{project.clients?.name || 'No client linked'} · {project.service || 'Creative project'}</span><small>{project.status.replaceAll('_', ' ')}{project.due_date ? ` · Due ${project.due_date}` : ''}</small></span><ArrowRight size={17} /></Link><Link className="button button-soft project-chat-link" to={`/studio/projects/${project.id}?tab=conversation`}><MessageCircle size={15} /> Chat</Link><button className="button button-danger" disabled={deletingId === project.id} onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`}>{deletingId === project.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button></article>)}</div> : <EmptyRecord title="A good project, all in one place." text="Start with a client, a brief, and a deadline. You can add notes, tasks, decisions, and Drive links inside." onCreate={() => setEditing(true)} />}{editing && <Modal title="Start a project" onClose={() => setEditing(false)}><form onSubmit={save}><label>Project name<input name="name" required maxLength="180" placeholder="e.g. A new identity for…" /></label><label>Client<select name="client_id" defaultValue=""><option value="">No client linked</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>{!clients.length && <small>Add a client record first, or leave this unassigned.</small>}</label><label>Service<select name="service" defaultValue=""><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label><label>Project brief<textarea name="brief" rows="4" maxLength="10000" placeholder="The goal, scope, and what success looks like…" /></label><label>Deadline<input type="date" name="due_date" /></label><label className="check-label"><input name="share_with_client" type="checkbox" /> Share this project in the client portal</label><button className="button button-dark" disabled={saving}>{saving ? 'Creating…' : 'Create project'} <ArrowRight size={15} /></button></form></Modal>}</main>
}

function ProjectRoom() {
  const { id } = useParams()
  const location = useLocation()
  const { user, workspace, error, setError } = useStudioWorkspace()
  const { markRead } = useContext(UnreadProjectMessagesContext)
  const [project, setProject] = useState(null)
  const [notes, setNotes] = useState([])
  const [tasks, setTasks] = useState([])
  const [links, setLinks] = useState([])
  const [feedback, setFeedback] = useState([])
  const [messages, setMessages] = useState([])
  const [activity, setActivity] = useState([])
  const [tab, setTab] = useState('Overview')
  const [savingProject, setSavingProject] = useState(false)
  useEffect(() => {
    setTab(new URLSearchParams(location.search).get('tab') === 'conversation' ? 'Conversation' : 'Overview')
  }, [id, location.search])
  useProjectMessageUpdates(id, user?.id, setMessages)
  useEffect(() => {
    if (tab === 'Conversation' && project && user?.id) {
      markRead(workspace.id, id)
    }
  }, [id, markRead, messages, project, tab, user?.id, workspace?.id])
  useEffect(() => {
    if (!supabase || !workspace?.id || !id) return
    Promise.all([
      supabase.from('projects').select('*, clients(name)').eq('id', id).eq('workspace_id', workspace.id).maybeSingle(),
      supabase.from('project_notes').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('project_tasks').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('project_links').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('project_feedback').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at'),
      supabase.from('project_messages').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at'),
      supabase.from('activity_events').select('*').eq('project_id', id).eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
    ]).then(([projectResult, noteResult, taskResult, linkResult, feedbackResult, messageResult, activityResult]) => {
      const errorResult = [projectResult, noteResult, taskResult, linkResult, feedbackResult, messageResult, activityResult].find((result) => result.error)
      if (errorResult?.error) setError(errorResult.error.message)
      setProject(projectResult.data)
      setNotes(noteResult.data || [])
      setTasks(taskResult.data || [])
      setLinks(linkResult.data || [])
      setFeedback(feedbackResult.data || [])
      setMessages(messageResult.data || [])
      setActivity(activityResult.data || [])
    })
  }, [workspace?.id, id, setError])
  async function addRecord(table, record, after) {
    if (!supabase || !workspace || !user) return
    const result = await supabase.from(table).insert({ workspace_id: workspace.id, project_id: id, created_by: user.id, ...record }).select().single()
    if (result.error) setError(result.error.message)
    else {
      after(result.data)
      const event = await supabase.from('activity_events').insert({ workspace_id: workspace.id, project_id: id, actor_id: user.id, event_type: table, summary: record.title || record.label || record.body || 'Updated project' }).select().single()
      if (event.error) setError(event.error.message)
      else setActivity((current) => [event.data, ...current])
    }
  }
  async function submitNote(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await addRecord('project_notes', { title: values.title, body: values.body, kind: values.kind, source: values.source, visible_to_client: values.visible_to_client === 'on' }, (item) => setNotes((current) => [item, ...current]))
    form.reset()
  }
  async function submitTask(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await addRecord('project_tasks', { title: values.title, due_date: values.due_date || null, visible_to_client: values.visible_to_client === 'on' }, (item) => setTasks((current) => [item, ...current]))
    form.reset()
  }
  async function submitLink(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    await addRecord('project_links', { label: values.label, url: values.url, kind: values.kind, visible_to_client: values.visible_to_client === 'on' }, (item) => setLinks((current) => [item, ...current]))
    form.reset()
  }
  async function submitMessage(event) {
    event.preventDefault()
    const form = event.currentTarget
    const body = new FormData(form).get('body')
    const result = await supabase.from('project_messages').insert({ workspace_id: workspace.id, project_id: id, sender_id: user.id, body }).select().single()
    if (result.error) setError(result.error.message)
    else {
      setMessages((current) => [...current, result.data])
      const event = await supabase.from('activity_events').insert({ workspace_id: workspace.id, project_id: id, actor_id: user.id, event_type: 'message', summary: 'Sent a project message' }).select().single()
      if (event.error) setError(event.error.message)
      else setActivity((current) => [event.data, ...current])
    }
    form.reset()
  }
  async function moveTask(task, status) {
    const result = await supabase.from('project_tasks').update({ status }).eq('id', task.id).eq('workspace_id', workspace.id).select().single()
    if (result.error) setError(result.error.message)
    else {
      setTasks((current) => current.map((entry) => entry.id === task.id ? result.data : entry))
      const event = await supabase.from('activity_events').insert({ workspace_id: workspace.id, project_id: id, actor_id: user.id, event_type: 'task_updated', summary: `Moved task "${task.title}" to ${status.replaceAll('_', ' ')}` }).select().single()
      if (event.error) setError(event.error.message)
      else setActivity((current) => [event.data, ...current])
    }
  }
  function taskDone(task) {
    return moveTask(task, task.status === 'done' ? 'todo' : 'done')
  }
  const editable = Boolean(workspace?.id && user?.id)
  const onMove = moveTask
  async function updateProject(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setSavingProject(true)
    const result = await supabase.from('projects').update({
      name: String(values.name).trim(),
      service: String(values.service || ''),
      brief: String(values.brief || '').trim(),
      status: values.status,
      due_date: values.due_date || null,
      share_with_client: values.share_with_client === 'on',
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('workspace_id', workspace.id).select('*, clients(name)').single()
    setSavingProject(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setProject(result.data)
    const eventResult = await supabase.from('activity_events').insert({
      workspace_id: workspace.id,
      project_id: id,
      actor_id: user.id,
      event_type: 'project_updated',
      summary: 'Updated project details and sharing settings',
    }).select().single()
    if (eventResult.error) setError(eventResult.error.message)
    else setActivity((current) => [eventResult.data, ...current])
  }
  if (error && !project) return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> Projects</Link><p className="notice-error">{error}</p></main>
  if (!project) return <main className="studio-page"><p className="loading-copy">Opening the project room…</p></main>
  if (tab === 'Overview') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'UNASSIGNED CLIENT'} / PROJECT DETAILS</p><h1>{project.name}</h1><p>Update the working brief, status, or what your client can access.</p></div>{error && <p className="notice-error">{error}</p>}{!isSupabaseConfigured && <p className="notice-error">{supabaseConfigMessage}</p>}<div className="room-tabs">{['Overview', 'Tasks', 'Notes & decisions', 'Links', 'Conversation', 'Activity'].map((name) => <button className={name === 'Overview' ? 'room-tab-active' : ''} key={name} onClick={() => setTab(name)}>{name}</button>)}</div><section className="room-pane"><form className="project-edit-form" onSubmit={updateProject}><label>Project name<input name="name" required maxLength="180" defaultValue={project.name} /></label><label>Service<select name="service" defaultValue={project.service || ''}><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label><label>Project status<select name="status" defaultValue={project.status}><option value="inquiry">Inquiry</option><option value="planning">Planning</option><option value="active">Active</option><option value="review">Review</option><option value="complete">Complete</option><option value="archived">Archived</option></select></label><label>Deadline<input type="date" name="due_date" defaultValue={project.due_date || ''} /></label><label className="project-brief-label">Project brief<textarea name="brief" rows="8" maxLength="10000" defaultValue={project.brief || ''} placeholder="Goals, scope, audience, references, and what success looks like…" /></label><label className="check-label"><input name="share_with_client" type="checkbox" defaultChecked={project.share_with_client} /> Share this project in the client portal</label><button className="button button-dark" disabled={savingProject}>{savingProject ? 'Saving…' : 'Save project details'}</button></form><div className="room-summary-cards project-summary-cards"><div><b>{tasks.filter((task) => task.status !== 'done').length}</b><span>OPEN TASKS</span></div><div><b>{notes.length}</b><span>PROJECT NOTES</span></div><div><b>{links.length}</b><span>PROJECT LINKS</span></div></div></section></main>
  if (tab === 'Tasks') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'UNASSIGNED CLIENT'} / SHARED TASK BOARD</p><h1>{project.name}</h1><p>Track the next steps and choose what your client can see.</p></div>{error && <p className="notice-error">{error}</p>}{tab === 'Tasks' && <section className="task-board"><div className="task-board-column"><header><h2>TODO</h2><span>{tasks.filter((task) => task.status === 'todo').length}</span></header>{tasks.filter((task) => task.status === 'todo').map((task) => <article className="task-board-card" key={task.id}>
        <p>{task.title}</p>
        <div><small>{task.due_date ? `Due ${task.due_date}` : 'No deadline'}</small><span className={task.visible_to_client ? 'note-kind note-shared' : 'note-kind'}>{task.visible_to_client ? 'SHARED' : 'PRIVATE'}</span></div>
        {editable && <label className="task-board-status">Move to<select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onMove(task, event.target.value)}>{taskStatuses.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}</select></label>}
      </article>)}</div>
      <div className="task-board-column"><header><h2>In progress</h2><span>{tasks.filter((task) => task.status === 'in_progress').length}</span></header>{tasks.filter((task) => task.status === 'in_progress').map((task) => <article className="task-board-card" key={task.id}>
        <p>{task.title}</p>
        <div><small>{task.due_date ? `Due ${task.due_date}` : 'No deadline'}</small><span className={task.visible_to_client ? 'note-kind note-shared' : 'note-kind'}>{task.visible_to_client ? 'SHARED' : 'PRIVATE'}</span></div>
        {editable && <label className="task-board-status">Move to<select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onMove(task, event.target.value)}>{taskStatuses.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}</select></label>}
      </article>)}</div>
      <div className="task-board-column"><header><h2>Done</h2><span>{tasks.filter((task) => task.status === 'done').length}</span></header>{tasks.filter((task) => task.status === 'done').map((task) => <article className="task-board-card" key={task.id}>
        <p>{task.title}</p>
        <div><small>{task.due_date ? `Due ${task.due_date}` : 'No deadline'}</small><span className={task.visible_to_client ? 'note-kind note-shared' : 'note-kind'}>{task.visible_to_client ? 'SHARED' : 'PRIVATE'}</span></div>
        {editable && <label className="task-board-status">Move to<select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onMove(task, event.target.value)}>{taskStatuses.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}</select></label>}
      </article>)}</div>
    </section>}</main>
  if (tab === 'Notes & decisions') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'UNASSIGNED CLIENT'} / PROJECT DOCUMENTS</p><h1>{project.name}</h1><p>Capture the brief, decisions, meetings, and delivery checks.</p></div>{error && <p className="notice-error">{error}</p>}{tab === 'Notes & decisions' && <section className="note-board"><div className="note-board-column"><header><h2>TODO</h2><span>{notes.filter((note) => note.kind === 'todo').length}</span></header>{notes.filter((note) => note.kind === 'todo').map((note) => <article className="note-board-card" key={note.id}>
        <p>{note.title}</p>
        <div><small>{note.body}</small></div>
      </article>)}</div>
      <div className="note-board-column"><header><h2>In progress</h2><span>{notes.filter((note) => note.kind === 'in_progress').length}</span></header>{notes.filter((note) => note.kind === 'in_progress').map((note) => <article className="note-board-card" key={note.id}>
        <p>{note.title}</p>
        <div><small>{note.body}</small></div>
      </article>)}</div>
      <div className="note-board-column"><header><h2>Done</h2><span>{notes.filter((note) => note.kind === 'done').length}</span></header>{notes.filter((note) => note.kind === 'done').map((note) => <article className="note-board-card" key={note.id}>
        <p>{note.title}</p>
        <div><small>{note.body}</small></div>
      </article>)}</div>
    </section>}</main>
  if (tab === 'Links') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'UNASSIGNED CLIENT'} / SHARED FILES</p><h1>{project.name}</h1><p>Attach project references, Drive folders, and deliverables.</p></div>{error && <p className="notice-error">{error}</p>}{tab === 'Links' && <section className="link-board"><div className="link-board-column"><header><h2>TODO</h2><span>{links.filter((link) => link.kind === 'todo').length}</span></header>{links.filter((link) => link.kind === 'todo').map((link) => <article className="link-board-card" key={link.id}>
        <p>{link.label}</p>
        <div><small>{link.url}</small></div>
      </article>)}</div>
      <div className="link-board-column"><header><h2>In progress</h2><span>{links.filter((link) => link.kind === 'in_progress').length}</span></header>{links.filter((link) => link.kind === 'in_progress').map((link) => <article className="link-board-card" key={link.id}>
        <p>{link.label}</p>
        <div><small>{link.url}</small></div>
      </article>)}</div>
      <div className="link-board-column"><header><h2>Done</h2><span>{links.filter((link) => link.kind === 'done').length}</span></header>{links.filter((link) => link.kind === 'done').map((link) => <article className="link-board-card" key={link.id}>
        <p>{link.label}</p>
        <div><small>{link.url}</small></div>
      </article>)}</div>
    </section>}</main>
  if (tab === 'Conversation') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'CLIENT'} / PROJECT CONVERSATION</p><h1>{project.name}</h1><p>Messages are saved to this project and shared with its invited client.</p></div>{error && <p className="notice-error">{error}</p>}{tab === 'Conversation' && <section className="conversation-pane"><header className="conversation-heading"><div className="record-avatar">{(project.clients?.name || 'C').slice(0, 1).toUpperCase()}</div><div><b>{project.clients?.name || 'Client'}</b><small>Project conversation · saved messages</small></div></header><div className="conversation-history">{messages.length ? messages.map((message) => <article className={`chat-message ${message.sender_id === user.id ? 'chat-message-own' : 'chat-message-other'}`} key={message.id}><span>{message.sender_id === user.id ? workspace?.studio_name || 'STUDIO' : project.clients?.name || 'CLIENT'} · {new Date(message.created_at).toLocaleString()}</span><p>{message.body}</p></article>) : <p className="empty-copy">No messages yet. Start the project conversation here.</p>}</div><form className="chat-form" onSubmit={submitMessage}><input name="body" required maxLength="10000" placeholder="Write a project message…" /><button className="button button-dark" aria-label="Send message"><Send size={16} /></button></form></section>}</main>
  if (tab === 'Activity') return <main className="studio-page"><Link to="/studio/projects" className="quiet-link"><ArrowLeft size={15} /> All projects</Link><div className="room-heading"><p className="kicker">{project.clients?.name || 'CLIENT'} / PROJECT HISTORY</p><h1>{project.name}</h1><p>Recent changes and conversations connected to this project.</p></div>{error && <p className="notice-error">{error}</p>}{tab === 'Activity' && <section className="activity-pane"><header className="activity-heading"><div className="record-avatar">{(project.clients?.name || 'C').slice(0, 1).toUpperCase()}</div><div><b>{project.clients?.name || 'Client'}</b><small>Project history · saved events</small></div></header><div className="activity-history">{activity.length ? activity.map((event) => <article className="note-record" key={event.id}><span className="note-kind">{event.event_type.replaceAll('_', ' ')}</span><p>{event.summary}</p><small>{new Date(event.created_at).toLocaleString()}</small></article>) : <p className="empty-copy">Project activity will appear here.</p>}</div></section>}</main>
}

function ProjectRoomTabs({ tab, setTab }) {
  return <div className="room-tabs">{['Overview', 'Tasks', 'Notes & decisions', 'Links', 'Conversation', 'Activity'].map((name) => <button className={name === tab ? 'room-tab-active' : ''} key={name} onClick={() => setTab(name)}>{name}</button>)}</div>
}

function PortfolioAdmin() {
  const { user, workspace, error, setError } = useStudioWorkspace()
  const [items, setItems] = useState(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const [groupIds, setGroupIds] = useState([])
  const [groupForm, setGroupForm] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  const [previewAssets, setPreviewAssets] = useState(null)
  const [publishingItem, setPublishingItem] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [importSegment, setImportSegment] = useState(portfolioSegments[0])
  const [importProgress, setImportProgress] = useState(null)
  const [importSummary, setImportSummary] = useState('')
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    supabase.from('portfolio_items').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false })
      .then(async ({ data, error: queryError }) => {
        if (queryError) { setError(queryError.message); return }
        const signed = await attachPortfolioCovers(data || [])
        if (signed.error) setError(signed.error.message)
        setItems(signed.data)
      })
  }, [workspace?.id, setError])

  function fileDetails(file) {
    const extension = file.name.split('.').pop()?.toLowerCase()
    const mimeType = extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'pdf'
          ? 'application/pdf'
          : ''
    return { mimeType, title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() }
  }

  async function refreshItems() {
    if (!supabase || !workspace) return
    const { data, error: queryError } = await supabase.from('portfolio_items')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
    if (queryError) {
      setError(queryError.message)
      return
    }
    const signed = await attachPortfolioCovers(data || [])
    if (signed.error) setError(signed.error.message)
    setItems(signed.data)
  }

  async function save(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user) return
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const title = String(form.title).trim()
    const file = form.cover_image
    let coverPath = null
    if (file instanceof File && file.size > 0) {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 50 * 1024 * 1024) {
        setError('Choose a JPG or PNG cover image smaller than 50 MB.')
        setSaving(false)
        return
      }
      coverPath = `${workspace.id}/${crypto.randomUUID()}.${file.type.split('/')[1]}`
      const upload = await uploadPortfolioFile(coverPath, file, file.type)
      if (upload.error) {
        setError(upload.error.message)
        setSaving(false)
        return
      }
    }
    const result = await supabase.from('portfolio_items').insert({
      workspace_id: workspace.id,
      title,
      segment: String(form.segment),
      service: String(form.service),
      summary: String(form.summary).trim(),
      slug: String(form.slug || title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    }).select().single()
    if (result.error && coverPath) {
      const cleanup = await supabase.storage.from('portfolio-media').remove([coverPath])
      if (cleanup.error) setError(`${result.error.message}. Could not clean up the uploaded cover: ${cleanup.error.message}`)
    }
    setSaving(false)
    if (result.error) setError(result.error.message)
    else {
      if (coverPath) {
        const asset = await supabase.from('portfolio_assets').insert({
          workspace_id: workspace.id,
          portfolio_item_id: result.data.id,
          storage_path: coverPath,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          created_by: user.id,
        })
        if (asset.error) {
          setError(asset.error.message)
          await refreshItems()
          setCreating(false)
          return
        }
      }
      const signed = await attachPortfolioCovers([result.data])
      if (signed.error) setError(signed.error.message)
      setItems((current) => [signed.data[0], ...(current || [])])
      setCreating(false)
    }
  }

  async function importFolder(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user || !selectedFiles.length) return
    const files = selectedFiles
    const invalid = files.filter((file) => {
      const { mimeType } = fileDetails(file)
      return !mimeType || file.size <= 0 || file.size > 50 * 1024 * 1024
    })
    if (invalid.length) {
      setError(`${invalid.length} selected file(s) are not supported or exceed the 50 MB per-file limit. Only JPG, PNG, and PDF files are accepted.`)
      return
    }
    setSaving(true)
    setError('')
    setImportSummary('')
    setImportProgress({ done: 0, total: files.length, failed: 0 })
    const failures = []

    for (const [index, file] of files.entries()) {
      const { mimeType, title } = fileDetails(file)
      const pathName = file.name.replace(/[\\/?#%:*|"<>]/g, '-').replace(/\s+/g, '-')
      const storagePath = `${workspace.id}/${crypto.randomUUID()}-${pathName}`
      const upload = await uploadPortfolioFile(storagePath, file, mimeType)
      if (upload.error) {
        failures.push(`${file.name}: ${upload.error.message}`)
        setImportProgress({ done: index + 1, total: files.length, failed: failures.length })
        continue
      }

      const coverPath = mimeType.startsWith('image/') ? storagePath : null
      const itemResult = await supabase.from('portfolio_items').insert({
        workspace_id: workspace.id,
        title: title || file.name,
        slug: `${(title || 'portfolio-item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150)}-${crypto.randomUUID().slice(0, 8)}`,
        segment: importSegment,
        service: '',
        summary: '',
        cover_path: coverPath,
      }).select('id').single()
      if (itemResult.error) {
        const cleanup = await supabase.storage.from('portfolio-media').remove([storagePath])
        const cleanupFailure = cleanup.error ? ` Cleanup also failed: ${cleanup.error.message}` : ''
        failures.push(`${file.name}: ${itemResult.error.message}.${cleanupFailure}`)
        setImportProgress({ done: index + 1, total: files.length, failed: failures.length })
        continue
      }

      const assetResult = await supabase.from('portfolio_assets').insert({
        workspace_id: workspace.id,
        portfolio_item_id: itemResult.data.id,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: mimeType,
        file_size: file.size,
        created_by: user.id,
      })
      if (assetResult.error) {
        const [itemCleanup, fileCleanup] = await Promise.all([
          supabase.from('portfolio_items').delete().eq('id', itemResult.data.id).eq('workspace_id', workspace.id),
          supabase.storage.from('portfolio-media').remove([storagePath]),
        ])
        const cleanupErrors = [itemCleanup.error?.message, fileCleanup.error?.message].filter(Boolean)
        failures.push(`${file.name}: ${assetResult.error.message}.${cleanupErrors.length ? ` Cleanup failed: ${cleanupErrors.join('; ')}` : ''}`)
      }
      setImportProgress({ done: index + 1, total: files.length, failed: failures.length })
    }

    await refreshItems()
    setSaving(false)
    setSelectedFiles([])
    setImporting(false)
    setImportSummary(failures.length
      ? `Imported ${files.length - failures.length} of ${files.length} files. ${failures.length} failed: ${failures.join(' | ')}`
      : `Imported all ${files.length} files as private portfolio drafts.`)
    setImportProgress(null)
  }

  function toggle(item) {
    if (!item.published) {
      if (!item.summary.trim()) {
        setError('Add a short project story before publishing this portfolio item.')
        return
      }
      setPublishingItem(item)
      return
    }
    updatePublishedStatus(item, false)
  }

  async function updatePublishedStatus(item, published, segment = item.segment) {
    if (!supabase || !workspace) return
    setSaving(true)
    const result = await supabase.from('portfolio_items').update({
      published,
      segment,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id).eq('workspace_id', workspace.id).select().single()
    if (result.error) {
      setError(result.error.message)
      setSaving(false)
    }
    else {
      const signed = await attachPortfolioCovers([result.data])
      if (signed.error) setError(signed.error.message)
      setItems((current) => current.map((entry) => entry.id === item.id ? signed.data[0] : entry))
      setPublishingItem(null)
      setSaving(false)
    }
  }

  async function publishItem(event) {
    event.preventDefault()
    if (!publishingItem || !workspace) return
    const segment = String(new FormData(event.currentTarget).get('segment') || '')
    if (!portfolioSegments.includes(segment)) {
      setError('Choose a portfolio segment before publishing this portfolio item.')
      return
    }
    await updatePublishedStatus(publishingItem, true, segment)
  }

  async function updatePortfolioItem(event) {
    event.preventDefault()
    if (!supabase || !workspace || !editingItem) return
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const title = String(form.title).trim()
    const slug = String(form.slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!slug) {
      setError('Use at least one letter or number in the public URL slug.')
      setSaving(false)
      return
    }
    const result = await supabase.from('portfolio_items').update({
      title,
      slug,
      segment: String(form.segment),
      service: String(form.service),
      summary: String(form.summary).trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', editingItem.id).eq('workspace_id', workspace.id).select().single()
    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    const signed = await attachPortfolioCovers([result.data])
    if (signed.error) setError(signed.error.message)
    setItems((current) => current.map((item) => item.id === editingItem.id ? signed.data[0] : item))
    setEditingItem(null)
  }

  async function openPreview(item) {
    setPreviewItem(item)
    setPreviewAssets(null)
    const result = await attachPortfolioAssets(item.id)
    if (result.error) {
      setError(result.error.message)
      setPreviewItem(null)
      return
    }
    setPreviewAssets(result.data)
  }

  async function groupItems(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user || groupIds.length < 2) return
    const selectedItems = (items || []).filter((item) => groupIds.includes(item.id))
    if (selectedItems.length !== groupIds.length || selectedItems.some((item) => item.published)) {
      setError('Only unpublished portfolio drafts can be grouped.')
      return
    }
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const title = String(form.title).trim()
    const created = await supabase.from('portfolio_items').insert({
      workspace_id: workspace.id,
      title,
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150)}-${crypto.randomUUID().slice(0, 8)}`,
      segment: String(form.segment),
      service: String(form.service),
      summary: String(form.summary).trim(),
    }).select('id').single()
    if (created.error) {
      setError(created.error.message)
      setSaving(false)
      return
    }
    const assets = await supabase.from('portfolio_assets')
      .select('storage_path, mime_type')
      .eq('workspace_id', workspace.id)
      .in('portfolio_item_id', groupIds)
      .order('sort_order')
    if (assets.error) {
      setError(assets.error.message)
      await supabase.from('portfolio_items').delete().eq('id', created.data.id).eq('workspace_id', workspace.id)
      setSaving(false)
      return
    }
    const coverPath = assets.data.find((asset) => asset.mime_type.startsWith('image/'))?.storage_path || null
    const updateAssets = await supabase.from('portfolio_assets')
      .update({ portfolio_item_id: created.data.id })
      .eq('workspace_id', workspace.id)
      .in('portfolio_item_id', groupIds)
    if (updateAssets.error) {
      setError(updateAssets.error.message)
      await supabase.from('portfolio_items').delete().eq('id', created.data.id).eq('workspace_id', workspace.id)
      setSaving(false)
      return
    }
    const updateCover = await supabase.from('portfolio_items')
      .update({ cover_path: coverPath })
      .eq('id', created.data.id)
      .eq('workspace_id', workspace.id)
    if (updateCover.error) {
      setError(updateCover.error.message)
      setSaving(false)
      return
    }
    const removeSources = await supabase.from('portfolio_items')
      .delete()
      .eq('workspace_id', workspace.id)
      .in('id', groupIds)
    if (removeSources.error) {
      setError(`The new case study is saved, but some source drafts could not be removed: ${removeSources.error.message}`)
      setSaving(false)
      await refreshItems()
      return
    }
    setSaving(false)
    setGroupIds([])
    setGroupForm(false)
    await refreshItems()
  }
  return <main className="studio-page">
    <StudioPageHeader kicker="PUBLIC PRESENCE / PORTFOLIO" title="Your work,<br />out in the world." action={<div className="portfolio-actions">
      {groupIds.length >= 2 && <button className="button button-soft" onClick={() => setGroupForm(true)}>Group {groupIds.length} drafts</button>}
      <button className="button button-soft" disabled={!workspace} onClick={() => setImporting(true)}><FolderKanban size={15} /> Import folder</button>
      <button className="button button-yellow" disabled={!workspace} onClick={() => setCreating(true)}><Plus size={16} /> Add a story</button>
    </div>} />
    {error && <p className="notice-error">{error}</p>}
    {importSummary && <p className="notice-success">{importSummary}</p>}
    {items === null ? <p className="loading-copy">Loading portfolio…</p> : items.length ? <>
      <p className="muted-copy">Imported files stay private as drafts. Select related drafts to group their images and PDFs into one case study, then publish only work you want public.</p>
      <div className="record-list">{items.map((item) => <article className="record-row" key={item.id}>
        <input className="portfolio-select" type="checkbox" aria-label={`Select ${item.title}`} disabled={item.published} checked={groupIds.includes(item.id)} onChange={(event) => setGroupIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
        <div className="work-thumb" style={item.cover_url ? { backgroundImage: `url("${item.cover_url}")` } : undefined}>✳</div>
        <div className="record-main"><b>{item.title}</b><span>{item.segment} · {item.service || 'Add a skill'} · {item.published ? 'Public' : 'Private draft'}</span><small>{window.location.origin}{appPath(`/portfolio/${item.slug}`)}</small></div>
        <button className="button button-soft" onClick={() => openPreview(item)}>Preview</button>
        <button className="button button-soft" onClick={() => setEditingItem(item)}>Edit</button>
        <button className="button button-soft" onClick={() => toggle(item)}>{item.published ? 'Unpublish' : 'Publish'}</button>
      </article>)}</div>
    </> : <EmptyRecord title="Your work deserves a good story." text="Import your portfolio folder, then review drafts and publish only the work you want to share." onCreate={() => setImporting(true)} />}
    {creating && <Modal title="Add portfolio story" onClose={() => setCreating(false)}><form onSubmit={save}>
      <label>Project title<input name="title" required maxLength="180" /></label>
      <label>Public URL slug<input name="slug" placeholder="generated-from-title" maxLength="180" /></label>
      <label>Portfolio segment<select name="segment" defaultValue={portfolioSegments[0]}>{portfolioSegments.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <label>Service<select name="service" defaultValue=""><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
      <label>Project summary<textarea name="summary" rows="4" required maxLength="5000" /></label>
      <label>Cover image<input name="cover_image" type="file" accept="image/jpeg,image/png" /></label>
      <button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Save as draft'} <ArrowRight size={15} /></button>
    </form></Modal>}
    {importing && <Modal title="Import portfolio files" onClose={() => { if (!saving) { setImporting(false); setSelectedFiles([]) } }}><form onSubmit={importFolder}>
      <p>Select your portfolio folder. Each JPG/PNG becomes a private draft with its filename as its starting title. PDFs are attached as downloadable portfolio files. Nothing is public until you publish it.</p>
      <label>Portfolio segment<select value={importSegment} onChange={(event) => setImportSegment(event.target.value)}>{portfolioSegments.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <label>Portfolio folder<input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple webkitdirectory="true" onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))} /></label>
      {selectedFiles.length > 0 && <p className="muted-copy">{selectedFiles.length} files selected · {(selectedFiles.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024)).toFixed(1)} MB selected</p>}
      {importProgress && <p className="notice-success">Uploading {importProgress.done} of {importProgress.total} · {importProgress.failed} failed</p>}
      <button className="button button-dark" disabled={saving || !selectedFiles.length}>{saving ? 'Importing files…' : 'Upload selected files'} <ArrowRight size={15} /></button>
    </form></Modal>}
    {groupForm && <Modal title={`Group ${groupIds.length} portfolio drafts`} onClose={() => { if (!saving) setGroupForm(false) }}><form onSubmit={groupItems}>
      <p>The selected private drafts’ files will be brought together under one new case study. Their original draft records will be removed.</p>
      <label>Case study title<input name="title" required maxLength="180" /></label>
      <label>Portfolio segment<select name="segment" defaultValue={portfolioSegments[0]}>{portfolioSegments.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <label>Service<select name="service" defaultValue=""><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
      <label>Project story<textarea name="summary" rows="4" required maxLength="5000" /></label>
      <button className="button button-dark" disabled={saving}>{saving ? 'Grouping files…' : 'Create case study'} <ArrowRight size={15} /></button>
    </form></Modal>}
    {editingItem && <Modal title="Edit portfolio story" onClose={() => { if (!saving) setEditingItem(null) }}><form onSubmit={updatePortfolioItem}>
      <label>Project title<input name="title" required maxLength="180" defaultValue={editingItem.title} /></label>
      <label>Public URL slug<input name="slug" required maxLength="180" defaultValue={editingItem.slug} /></label>
      <label>Portfolio segment<select name="segment" defaultValue={editingItem.segment}>{portfolioSegments.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <label>Service<select name="service" defaultValue={editingItem.service}><option value="">Choose a service</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
      <label>Project story<textarea name="summary" rows="5" required maxLength="5000" defaultValue={editingItem.summary} /></label>
      <button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Save story'} <ArrowRight size={15} /></button>
    </form></Modal>}
    {previewItem && <Modal title={`Preview: ${previewItem.title}`} onClose={() => { setPreviewItem(null); setPreviewAssets(null) }}>
      <p className="muted-copy">{previewItem.segment} · {previewItem.service || 'Portfolio work'} · {previewItem.published ? 'Currently public' : 'Private draft'}</p>
      {previewAssets === null ? <p className="loading-copy">Loading your files…</p> : previewAssets.length ? <div className="portfolio-preview-assets">
        {previewAssets.map((asset) => asset.mime_type.startsWith('image/')
          ? <figure key={asset.id}><img src={asset.url} alt={asset.file_name} /><figcaption>{asset.file_name}</figcaption></figure>
          : <figure key={asset.id}><iframe title={asset.file_name} src={asset.url} /><figcaption><a href={asset.url} target="_blank" rel="noreferrer">{asset.file_name} <ExternalLink size={14} /></a></figcaption></figure>)}
      </div> : <div className="portfolio-preview-empty"><p>No uploaded files are attached to this story yet.</p>{previewItem.cover_url && <img src={previewItem.cover_url} alt={previewItem.title} />}</div>}
    </Modal>}
    {publishingItem && <Modal title={`Publish: ${publishingItem.title}`} onClose={() => setPublishingItem(null)}><form onSubmit={publishItem}>
      <p>Choose the portfolio segment where this work should appear. Visitors will see it in this segment as soon as you publish.</p>
      <label>Publish to segment<select name="segment" required defaultValue={publishingItem.segment}>{portfolioSegments.map((segment) => <option key={segment}>{segment}</option>)}</select></label>
      <button className="button button-dark" disabled={saving}>{saving ? 'Publishing…' : 'Publish to portfolio'} <ArrowRight size={15} /></button>
    </form></Modal>}
  </main>
}

const socialPlatforms = [
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/', limit: 2200 },
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/upload/', limit: 2200 },
  { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/', limit: 5000 },
  { id: 'x', label: 'X', url: 'https://x.com/compose/post', limit: 280 },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/feed/', limit: 3000 },
  { id: 'youtube', label: 'YouTube', url: 'https://studio.youtube.com/', limit: 5000 },
]

const postStatuses = [
  ['draft', 'Draft'],
  ['planned', 'Planned'],
  ['scheduled_externally', 'Scheduled externally'],
  ['published', 'Published'],
]

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTimeValue(value) {
  if (!value) return ''
  const date = new Date(value)
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function platformName(platform) {
  return socialPlatforms.find((entry) => entry.id === platform)?.label || platform
}

function ContentCalendar() {
  const { user, workspace } = useStudioWorkspace()
  const now = new Date()
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(localDateKey(now))
  const [platformFilter, setPlatformFilter] = useState('all')
  const [posts, setPosts] = useState([])
  const [assets, setAssets] = useState([])
  const [portfolioWorks, setPortfolioWorks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [copiedAltId, setCopiedAltId] = useState('')
  const [copiedVideoId, setCopiedVideoId] = useState('')
  const [copiedImagePromptId, setCopiedImagePromptId] = useState('')
  const [campaignSetup, setCampaignSetup] = useState(null)
  const [campaignDrafts, setCampaignDrafts] = useState(null)
  const [campaignPlatforms, setCampaignPlatforms] = useState([])
  const [generating, setGenerating] = useState(false)

  const refresh = useCallback(async () => {
    if (!supabase || !workspace?.id) return
    setLoading(true)
    setError('')
    const [postResult, assetResult, workResult] = await Promise.all([
      supabase.from('social_content_posts')
        .select('id, platform, caption, alt_text, content_type, video_generation_prompt, image_generation_prompt, generated_image_path, planned_at, status, portfolio_asset_id, portfolio_item_id, copied_at, copy_count, used_at, published_at, created_at, updated_at')
        .eq('workspace_id', workspace.id)
        .order('planned_at', { ascending: true, nullsFirst: false }),
      supabase.from('portfolio_assets')
        .select('id, portfolio_item_id, file_name, mime_type, storage_path, portfolio_items!inner(id, title, service, summary, segment)')
        .eq('workspace_id', workspace.id)
        .in('mime_type', ['image/jpeg', 'image/png'])
        .order('created_at', { ascending: false }),
        supabase.from('portfolio_items')
        .select('id, title, service, summary, segment')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false }),
    ])
      const failed = [postResult, assetResult, workResult].find((result) => result.error)
    if (failed?.error) {
      setError(failed.error.message)
      setLoading(false)
      return
    }
    const [signedAssets, signedPosts] = await Promise.all([
      Promise.all((assetResult.data || []).map(async (asset) => {
      const signed = await supabase.storage.from('portfolio-media').createSignedUrl(asset.storage_path, 3600)
      return { ...asset, title: asset.portfolio_items?.title || asset.file_name, url: signed.data?.signedUrl || '' }
      })),
      Promise.all((postResult.data || []).map(async (post) => {
        if (!post.generated_image_path) return post
        const signed = await supabase.storage.from('portfolio-media').createSignedUrl(post.generated_image_path, 3600)
        if (signed.error) throw signed.error
        return { ...post, generated_image_url: signed.data.signedUrl }
      })),
    ]).catch((signError) => {
      setError(`Could not load a generated post image: ${signError.message}`)
      return [null, null]
    })
    if (!signedAssets || !signedPosts) {
      setLoading(false)
      return
    }
    setPosts(signedPosts)
    setAssets(signedAssets)
    setPortfolioWorks(workResult.data || [])
    setLoading(false)
  }, [workspace?.id])

  useEffect(() => {
    if (workspace?.id) refresh()
  }, [refresh, workspace?.id])

  useEffect(() => {
    setCampaignPlatforms(workspace?.enabled_social_platforms || socialPlatforms.map(({ id }) => id))
  }, [workspace?.id, workspace?.enabled_social_platforms])

  function openEditor(post = null, date = selectedDate) {
    setError('')
    setEditor(post
      ? { ...post, planned_local: localDateTimeValue(post.planned_at), portfolio_asset_id: post.portfolio_asset_id || '' }
      : { platform: platformFilter === 'all' ? 'instagram' : platformFilter, caption: '', alt_text: '', video_generation_prompt: '', content_type: 'educational_solution', planned_local: `${date}T09:00`, status: 'planned', portfolio_asset_id: '' })
  }

  function openCampaign(date = selectedDate) {
    setError('')
    setCampaignSetup({
      planned_local: `${date}T09:00`,
    })
  }

  async function generateCampaign(event) {
    event.preventDefault()
    if (!campaignPlatforms.length) {
      setError('Enable at least one social platform in studio settings before generating content.')
      return
    }
    if (!supabase) return
    setGenerating(true)
    setError('')
    let data
    let generationError
    try {
      ({ data, error: generationError } = await supabase.functions.invoke('generate-social-content', {
        body: {
          platforms: campaignPlatforms,
          contact_url: new URL(appPath('/contact'), window.location.origin).toString(),
        },
        timeout: 110_000,
      }))
    } catch (requestError) {
      setGenerating(false)
      setError(requestError.name === 'FunctionsFetchError'
        ? 'The content generation request timed out or could not reach Supabase. Please try again.'
        : requestError.message || 'Could not reach the content generation service.')
      return
    }
    setGenerating(false)
    if (generationError || data?.error) {
      let functionErrorMessage = ''
      if (generationError?.context instanceof Response) {
        const responseText = await generationError.context.text()
        try {
          const errorBody = JSON.parse(responseText)
          if (typeof errorBody.error === 'string') functionErrorMessage = errorBody.error
          else if (typeof errorBody.message === 'string') functionErrorMessage = errorBody.message
        } catch (parseError) {
          console.warn('Could not parse the content generation error response.', parseError)
        }
      }
      setError(data?.error || functionErrorMessage || generationError?.message || 'Could not generate social content.')
      return
    }
    const selectedWork = data?.project || null
    const contentType = data?.content_type
      || (selectedWork ? 'portfolio_story' : 'educational_solution')
    if (!['portfolio_story', 'educational_solution'].includes(contentType)
      || (contentType === 'portfolio_story' && (!selectedWork || typeof selectedWork.id !== 'string'))
      || (contentType === 'educational_solution' && selectedWork)
      || !Array.isArray(data.drafts)
      || data.drafts.length !== campaignPlatforms.length
      || data.drafts.some((draft) => !campaignPlatforms.includes(draft.platform)
        || typeof draft.caption !== 'string'
        || (['instagram', 'tiktok', 'youtube'].includes(draft.platform)
          && typeof draft.video_prompt !== 'string'))) {
      setError('The content service returned an incomplete or incompatible response. Please generate again. If it continues, reload the page to update the studio.')
      return
    }
    const selectedAsset = selectedWork ? assets.find((asset) => asset.portfolio_item_id === selectedWork.id) : null
    let generatedImage = null
    if (data.generated_image_path) {
      const { data: signedImage, error: signedImageError } = await supabase.storage
        .from('portfolio-media')
        .createSignedUrl(data.generated_image_path, 3600)
      if (signedImageError || !signedImage?.signedUrl) {
        setError(`The post was generated, but its image could not be previewed: ${signedImageError?.message || 'Signed URL was not returned.'}`)
        const { error: cleanupError } = await supabase.storage.from('portfolio-media').remove([data.generated_image_path])
        if (cleanupError) console.error('Could not remove an unpreviewable generated image:', cleanupError.message)
        return
      }
      generatedImage = { path: data.generated_image_path, url: signedImage.signedUrl }
    }
    const plannedAt = campaignSetup.planned_local
      ? new Date(campaignSetup.planned_local).toISOString()
      : null
    setCampaignDrafts({
      work: selectedWork,
      asset: selectedAsset || null,
      generatedImage,
      generatedImageError: data.generated_image_error || '',
      imageGenerationPrompt: data.image_generation_prompt || '',
      contentType,
      plannedAt,
      angle: data.angle,
      rationale: data.rationale,
      drafts: data.drafts,
    })
    setCampaignSetup(null)
  }

  function editCampaignCaption(platform, caption) {
    setCampaignDrafts((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.platform === platform ? { ...draft, caption } : draft),
    }))
  }

  function editCampaignVideoPrompt(platform, video_prompt) {
    setCampaignDrafts((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => draft.platform === platform ? { ...draft, video_prompt } : draft),
    }))
  }

  async function saveCampaign() {
    if (!supabase || !workspace?.id || !user?.id || !campaignDrafts) return
    if (campaignDrafts.drafts.some((draft) => !draft.caption.trim())) {
      setError('Each platform needs a caption before saving the campaign.')
      return
    }
    setSaving(true)
    setError('')
    const result = await supabase.from('social_content_posts').insert(campaignDrafts.drafts.map((draft) => ({
      workspace_id: workspace.id,
      created_by: user.id,
      platform: draft.platform,
      caption: draft.caption.trim(),
      alt_text: draft.alt_text.trim(),
      content_type: campaignDrafts.contentType,
      video_generation_prompt: draft.video_prompt.trim(),
      image_generation_prompt: campaignDrafts.imageGenerationPrompt,
      generated_image_path: campaignDrafts.generatedImage?.path || null,
      planned_at: campaignDrafts.plannedAt,
      status: campaignDrafts.plannedAt ? 'planned' : 'draft',
      portfolio_item_id: campaignDrafts.work?.id || null,
      portfolio_asset_id: campaignDrafts.asset?.id || null,
    })))
    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    if (campaignDrafts.plannedAt) {
      const date = new Date(campaignDrafts.plannedAt)
      const dateKey = localDateKey(date)
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1))
      setSelectedDate(dateKey)
    }
    setCampaignDrafts(null)
    await refresh()
  }

  async function discardCampaignDrafts() {
    const imagePath = campaignDrafts?.generatedImage?.path
    setCampaignDrafts(null)
    if (!imagePath || !supabase) return
    const { error: removeError } = await supabase.storage.from('portfolio-media').remove([imagePath])
    if (removeError) setError(`Draft closed, but its generated image could not be removed: ${removeError.message}`)
  }

  async function savePost(event) {
    event.preventDefault()
    if (!supabase || !workspace?.id || !user?.id || !editor) return
    setSaving(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const dateValue = String(form.get('planned_local') || '')
    const requestedStatus = String(form.get('status'))
    const payload = {
      workspace_id: workspace.id,
      created_by: user.id,
      platform: String(form.get('platform')),
      caption: String(form.get('caption')).trim(),
      alt_text: String(form.get('alt_text') || '').trim(),
      content_type: editor.content_type || 'educational_solution',
      video_generation_prompt: String(form.get('video_generation_prompt') || '').trim(),
      image_generation_prompt: editor.image_generation_prompt || '',
      planned_at: dateValue ? new Date(dateValue).toISOString() : null,
      status: requestedStatus,
      portfolio_asset_id: String(form.get('portfolio_asset_id') || '') || null,
      portfolio_item_id: assets.find((asset) => asset.id === String(form.get('portfolio_asset_id') || ''))?.portfolio_item_id || editor.portfolio_item_id || null,
      generated_image_path: editor.generated_image_path || null,
      updated_at: new Date().toISOString(),
    }
    const result = editor.id
      ? await supabase.from('social_content_posts').update(payload).eq('id', editor.id).eq('workspace_id', workspace.id).select('id').single()
      : await supabase.from('social_content_posts').insert(payload).select('id').single()
    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    if (requestedStatus === 'published') {
      const { error: trackingError } = await supabase.rpc('track_social_content_post', {
        target_post: editor.id || result.data?.id,
        event_name: 'published',
      })
      if (trackingError) {
        setError(`Post saved, but publication could not be recorded: ${trackingError.message}`)
        setEditor(null)
        await refresh()
        return
      }
    }
    setEditor(null)
    await refresh()
  }

  async function trackPostEvent(post, eventName, failureLabel) {
    try {
      const { data, error: trackError } = await supabase.rpc('track_social_content_post', {
        target_post: post.id,
        event_name: eventName,
      })
      if (trackError) throw trackError
      const trackedPost = data?.[0]
      if (!trackedPost) throw new Error('The tracking response was empty.')
      setPosts((current) => current.map((entry) => entry.id === post.id ? { ...entry, ...trackedPost } : entry))
      return true
    } catch (trackError) {
      setError(`${failureLabel}: ${trackError.message || 'Could not record this activity.'}`)
      return false
    }
  }

  async function changeStatus(post, status) {
    if (status === 'published') {
      await trackPostEvent(post, 'published', 'Could not record publication')
      return
    }
    const { error: updateError } = await supabase.from('social_content_posts')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', post.id)
      .eq('workspace_id', workspace.id)
    if (updateError) setError(updateError.message)
    else setPosts((current) => current.map((entry) => entry.id === post.id ? { ...entry, status } : entry))
  }

  async function markPostUsed(post) {
    await trackPostEvent(post, 'used', 'Could not record used status')
  }

  async function removePost(post) {
    if (!window.confirm('Delete this planned post?')) return
    const { error: deleteError } = await supabase.from('social_content_posts').delete().eq('id', post.id).eq('workspace_id', workspace.id)
    if (deleteError) setError(deleteError.message)
    else {
      setPosts((current) => current.filter((entry) => entry.id !== post.id))
      if (post.generated_image_path) {
        const { count, error: referenceError } = await supabase.from('social_content_posts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('generated_image_path', post.generated_image_path)
        if (referenceError) {
          setError(`Post deleted, but generated image cleanup could not be checked: ${referenceError.message}`)
          return
        }
        if (count === 0) {
          const { error: imageDeleteError } = await supabase.storage
            .from('portfolio-media')
            .remove([post.generated_image_path])
          if (imageDeleteError) setError(`Post deleted, but its generated image could not be removed: ${imageDeleteError.message}`)
        }
      }
    }
  }

  async function copyCaption(post) {
    try {
      await navigator.clipboard.writeText(post.caption)
    } catch {
      setError('Clipboard access is unavailable. Select and copy the caption from Edit instead.')
      return
    }
    if (!await trackPostEvent(post, 'copied', 'Caption copied, but usage could not be recorded')) return
    setCopiedId(post.id)
    window.setTimeout(() => setCopiedId(''), 1800)
  }

  async function copyImageDescription(post) {
    try {
      await navigator.clipboard.writeText(post.alt_text)
      setCopiedAltId(post.id)
      window.setTimeout(() => setCopiedAltId(''), 1800)
    } catch {
      setError('Clipboard access is unavailable. Edit the post to select its image description.')
    }
  }

  async function copyVideoPrompt(post) {
    await copyVideoPromptText(post.video_generation_prompt, post.id)
  }

  async function copyVideoPromptText(prompt, key) {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedVideoId(key)
      window.setTimeout(() => setCopiedVideoId(''), 1800)
    } catch {
      setError('Clipboard access is unavailable. Select and copy the Google Flow prompt manually.')
    }
  }

  async function copyImageGenerationPrompt(prompt, key) {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedImagePromptId(key)
      window.setTimeout(() => setCopiedImagePromptId(''), 1800)
    } catch {
      setError('Clipboard access is unavailable. Select and copy the image-generation prompt manually.')
    }
  }

  async function downloadAsset(post) {
    const asset = assets.find((entry) => entry.id === post.portfolio_asset_id)
    const imageUrl = asset?.url || post.generated_image_url
    if (!imageUrl) {
      setError('This post image is unavailable. Edit the post and choose or generate another image.')
      return
    }
    try {
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error('Could not download this image.')
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      const extension = post.generated_image_path?.split('.').pop() || 'png'
      link.download = asset?.file_name || `glyph-social-${post.id}.${extension}`
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (downloadError) {
      setError(downloadError.message || 'Could not download this image.')
    }
  }

  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1
    return day > 0 && day <= daysInMonth ? new Date(month.getFullYear(), month.getMonth(), day) : null
  })
  const visiblePosts = platformFilter === 'all' ? posts : posts.filter((post) => post.platform === platformFilter)
  const datedPosts = visiblePosts.filter((post) => post.planned_at)
  const selectedPosts = datedPosts.filter((post) => localDateKey(new Date(post.planned_at)) === selectedDate)
    .sort((first, second) => new Date(first.planned_at) - new Date(second.planned_at))
  const draftPosts = visiblePosts.filter((post) => !post.planned_at)
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return <main className="studio-page calendar-page">
    <StudioPageHeader kicker="SOCIAL / PLAN & HAND OFF" title="Make a date<br />with your audience." action={<div className="calendar-header-actions"><button className="button button-soft" disabled={!workspace || !campaignPlatforms.length} onClick={() => openCampaign(selectedDate)}><Sparkles size={15} /> Generate AI content</button><button className="button button-dark" disabled={!workspace} onClick={() => openEditor(null, selectedDate)}><Plus size={16} /> Plan a post</button></div>} />
    <div className="calendar-note"><CalendarDays size={18} /><p>Gemini balances practical educational solutions with portfolio stories, then prepares platform-specific drafts. Instagram, TikTok, and YouTube drafts include editable Google Flow video prompts. Review, edit, copy, then publish manually.</p></div>
    {error && <p className="notice-error">{error}</p>}
    <div className="calendar-toolbar">
      <div className="calendar-month-controls"><button className="icon-button" aria-label="Previous month" onClick={() => { const nextMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1); setMonth(nextMonth); setSelectedDate(localDateKey(nextMonth)) }}><ChevronLeft /></button><h2>{monthLabel}</h2><button className="icon-button" aria-label="Next month" onClick={() => { const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1); setMonth(nextMonth); setSelectedDate(localDateKey(nextMonth)) }}><ChevronRight /></button><button className="button button-soft" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(localDateKey(today)) }}>Today</button></div>
      <div className="calendar-filters" aria-label="Filter posts by platform">{[['all', 'All'], ...socialPlatforms.map(({ id, label }) => [id, label === 'Facebook Page' ? 'Facebook' : label])].map(([id, label]) => <button key={id} className={platformFilter === id ? 'calendar-filter-active' : ''} onClick={() => setPlatformFilter(id)}>{label}</button>)}</div>
    </div>
    <p className="calendar-timezone">Dates and times use {timezone}.</p>
    {loading ? <p className="loading-copy">Loading your content plan…</p> : <>
      <div className="calendar-layout">
        <section className="calendar-month" aria-label={monthLabel}>
          <div className="calendar-grid calendar-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">{cells.map((date, index) => {
            const key = date ? localDateKey(date) : `empty-${index}`
            const count = date ? datedPosts.filter((post) => localDateKey(new Date(post.planned_at)) === key).length : 0
            return date
              ? <button key={key} className={`calendar-day ${selectedDate === key ? 'calendar-day-selected' : ''} ${key === localDateKey(now) ? 'calendar-day-today' : ''}`} onClick={() => setSelectedDate(key)} aria-pressed={selectedDate === key}>
                <span>{date.getDate()}</span>{count > 0 && <small>{count} {count === 1 ? 'post' : 'posts'}</small>}
                <div>{datedPosts.filter((post) => localDateKey(new Date(post.planned_at)) === key).slice(0, 2).map((post) => <i className={`platform-dot platform-${post.platform}`} key={post.id}>{platformName(post.platform)}</i>)}</div>
              </button>
              : <span className="calendar-day calendar-day-empty" key={key} aria-hidden="true" />
          })}</div>
        </section>
        <aside className="calendar-agenda">
          <header><div><p className="kicker">DAY PLAN</p><h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div><button className="icon-button" aria-label="Plan a post for this day" onClick={() => openEditor(null, selectedDate)}><Plus /></button></header>
          {selectedPosts.length ? <div className="calendar-post-list">{selectedPosts.map((post) => <CalendarPost key={post.id} post={post} assets={assets} copied={copiedId === post.id} copiedAlt={copiedAltId === post.id} copiedVideo={copiedVideoId === post.id} copiedImagePrompt={copiedImagePromptId === post.id} onEdit={() => openEditor(post)} onDelete={() => removePost(post)} onCopy={() => copyCaption(post)} onCopyAlt={() => copyImageDescription(post)} onCopyVideo={() => copyVideoPrompt(post)} onCopyImagePrompt={() => copyImageGenerationPrompt(post.image_generation_prompt, post.id)} onDownload={() => downloadAsset(post)} onStatus={(status) => changeStatus(post, status)} onUsed={() => markPostUsed(post)} />)}</div> : <p className="empty-copy">Nothing planned for this day.</p>}
        </aside>
      </div>
      <section className="calendar-drafts"><div className="studio-section-heading"><div><p className="kicker">NO DATE SET</p><h2>Drafts</h2></div><span>{draftPosts.length}</span></div>{draftPosts.length ? <div className="calendar-post-list">{draftPosts.map((post) => <CalendarPost key={post.id} post={post} assets={assets} copied={copiedId === post.id} copiedAlt={copiedAltId === post.id} copiedVideo={copiedVideoId === post.id} copiedImagePrompt={copiedImagePromptId === post.id} onEdit={() => openEditor(post)} onDelete={() => removePost(post)} onCopy={() => copyCaption(post)} onCopyAlt={() => copyImageDescription(post)} onCopyVideo={() => copyVideoPrompt(post)} onCopyImagePrompt={() => copyImageGenerationPrompt(post.image_generation_prompt, post.id)} onDownload={() => downloadAsset(post)} onStatus={(status) => changeStatus(post, status)} onUsed={() => markPostUsed(post)} />)}</div> : <p className="empty-copy">Unscheduled drafts will collect here.</p>}
    </section>
    </>}
  {editor && <Modal title={editor.id ? 'Edit planned post' : 'Plan a social post'} onClose={() => { if (!saving) setEditor(null) }}><form onSubmit={savePost}>
      <label>Platform<select name="platform" value={editor.platform} onChange={(event) => setEditor((current) => ({ ...current, platform: event.target.value }))}>{socialPlatforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.label}</option>)}</select></label>
      <label>Caption<textarea name="caption" required maxLength={5000} rows="5" value={editor.caption} onChange={(event) => setEditor((current) => ({ ...current, caption: event.target.value }))} placeholder="Write the caption for this platform…" /></label>
      <label>Image description for accessibility<textarea name="alt_text" maxLength={1000} rows="2" value={editor.alt_text || ''} onChange={(event) => setEditor((current) => ({ ...current, alt_text: event.target.value }))} placeholder="Describe what is visibly in the image…" /></label>
      {['instagram', 'tiktok', 'youtube'].includes(editor.platform) && <label>Google Flow video prompt<textarea name="video_generation_prompt" maxLength={3000} rows="5" value={editor.video_generation_prompt || ''} onChange={(event) => setEditor((current) => ({ ...current, video_generation_prompt: event.target.value }))} placeholder="Describe the short-form video to generate in Google Flow…" /></label>}
      <label>Post date and time<input name="planned_local" type="datetime-local" value={editor.planned_local || ''} onChange={(event) => setEditor((current) => ({ ...current, planned_local: event.target.value }))} /><small className="calendar-field-note">Local time: {timezone}. Leave blank to keep this in Drafts.</small></label>
      <label>Portfolio image<select name="portfolio_asset_id" value={editor.portfolio_asset_id || ''} onChange={(event) => setEditor((current) => ({ ...current, portfolio_asset_id: event.target.value }))}><option value="">No image selected</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} · {asset.file_name}</option>)}</select></label>
      {editor.portfolio_asset_id && assets.find((asset) => asset.id === editor.portfolio_asset_id)?.url && <img className="calendar-image-preview" src={assets.find((asset) => asset.id === editor.portfolio_asset_id).url} alt="Selected portfolio image" />}
      {!editor.portfolio_asset_id && editor.generated_image_url && <img className="calendar-image-preview" src={editor.generated_image_url} alt="Generated educational post image" />}
      {editor.image_generation_prompt && <div className="campaign-image-prompt"><label htmlFor="post-image-generation-prompt">Image generation prompt</label><textarea id="post-image-generation-prompt" rows="5" maxLength="5000" value={editor.image_generation_prompt} onChange={(event) => setEditor((current) => ({ ...current, image_generation_prompt: event.target.value }))} /><button className="button button-soft" type="button" onClick={() => copyImageGenerationPrompt(editor.image_generation_prompt, editor.id || 'editor')}>{copiedImagePromptId === (editor.id || 'editor') ? 'Copied' : 'Copy image prompt'}</button></div>}
      <label>Planning status<select name="status" value={editor.status} onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value }))}>{postStatuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p className="muted-copy">Status is your note only. GLYPH cannot see whether a post was scheduled or published on the platform.</p>
      <button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : editor.id ? 'Save changes' : 'Save post'} <Check size={15} /></button>
    </form></Modal>}
    {campaignSetup && <Modal title="Generate audience-first content" onClose={() => { if (!generating) setCampaignSetup(null) }}><form onSubmit={generateCampaign}>
      <p className="muted-copy">Gemini alternates practical educational solutions with portfolio stories. Educational posts include an original generated image; video platforms also get a Google Flow prompt. Image generation may use additional Gemini API quota or incur charges.</p>
      <div className="campaign-platform-list"><b>Enabled platforms</b><div>{campaignPlatforms.map((id) => <span key={id}>{platformName(id)}</span>)}</div><small>Manage platforms in Studio settings.</small></div>
      <label>Calendar date and time<input type="datetime-local" value={campaignSetup.planned_local} onChange={(event) => setCampaignSetup((current) => ({ ...current, planned_local: event.target.value }))} /><small className="calendar-field-note">Local time: {timezone}. Leave blank to save as an unscheduled draft.</small></label>
      <button className="button button-dark" disabled={generating || !campaignPlatforms.length}>{generating ? 'Writing & creating your image…' : 'Generate useful posts'} <Sparkles size={15} /></button>
    </form></Modal>}
    {campaignDrafts && <Modal title="Review campaign drafts" onClose={() => { if (!saving) void discardCampaignDrafts() }}><div className="campaign-review">
      <div className="campaign-review-work">{(campaignDrafts.generatedImage?.url || campaignDrafts.asset?.url) && <img src={campaignDrafts.generatedImage?.url || campaignDrafts.asset?.url} alt={campaignDrafts.generatedImage ? 'Generated educational post preview' : ''} />}<div><b>{campaignDrafts.contentType === 'educational_solution' ? 'Educational solution' : campaignDrafts.work.title}</b><span>{campaignDrafts.contentType === 'educational_solution' ? 'Practical, audience-first content with generated artwork' : `${campaignDrafts.work.segment || campaignDrafts.work.service || 'Portfolio work'} · `}{campaignDrafts.plannedAt ? new Date(campaignDrafts.plannedAt).toLocaleString() : 'No date'}</span></div></div>
      {campaignDrafts.generatedImage?.url && <img className="campaign-generated-image-preview" src={campaignDrafts.generatedImage.url} alt="Full preview of generated social post artwork" />}
      <section className="campaign-angle"><b>Content angle</b><p>{campaignDrafts.angle}</p><small>{campaignDrafts.rationale}</small></section>
      <p className="muted-copy">Review and edit every draft before saving. GLYPH does not post or schedule externally.</p>
      {campaignDrafts.generatedImageError && <p className="campaign-image-warning">{campaignDrafts.generatedImageError} You can still save the captions and generate the image later from the saved prompt.</p>}
      {!campaignDrafts.generatedImage?.url && campaignDrafts.imageGenerationPrompt && <div className="campaign-image-prompt"><label htmlFor="campaign-image-prompt">Image generation prompt</label><textarea id="campaign-image-prompt" rows="5" maxLength="5000" value={campaignDrafts.imageGenerationPrompt} onChange={(event) => setCampaignDrafts((current) => ({ ...current, imageGenerationPrompt: event.target.value }))} /><button className="button button-soft" type="button" onClick={() => copyImageGenerationPrompt(campaignDrafts.imageGenerationPrompt, 'campaign')}>{copiedImagePromptId === 'campaign' ? 'Copied' : 'Copy image prompt'}</button><small>Save the captions now, then use this prompt in an image-generation tool when available.</small></div>}
      {campaignDrafts.drafts.map((draft) => <section className="campaign-draft" key={draft.platform}><header><b>{platformName(draft.platform)}</b></header><label htmlFor={`campaign-caption-${draft.platform}`}>{platformName(draft.platform)} caption</label><textarea id={`campaign-caption-${draft.platform}`} rows={draft.platform === 'x' ? 4 : 6} maxLength={socialPlatforms.find((platform) => platform.id === draft.platform)?.limit || 5000} value={draft.caption} onChange={(event) => editCampaignCaption(draft.platform, event.target.value)} /><small className="campaign-character-count">{draft.caption.length} / {socialPlatforms.find((platform) => platform.id === draft.platform)?.limit || 5000} characters</small><label htmlFor={`campaign-alt-${draft.platform}`}>Optional image description (Gemini does not see images)</label><textarea id={`campaign-alt-${draft.platform}`} rows="2" maxLength="1000" value={draft.alt_text} onChange={(event) => setCampaignDrafts((current) => ({ ...current, drafts: current.drafts.map((entry) => entry.platform === draft.platform ? { ...entry, alt_text: event.target.value } : entry) }))} />{draft.video_prompt && <div className="campaign-video-prompt"><label htmlFor={`campaign-video-${draft.platform}`}>Google Flow video-generation prompt</label><textarea id={`campaign-video-${draft.platform}`} rows="6" maxLength="3000" value={draft.video_prompt} onChange={(event) => editCampaignVideoPrompt(draft.platform, event.target.value)} /><button className="button button-soft" type="button" onClick={() => copyVideoPromptText(draft.video_prompt, draft.platform)}><Copy size={14} /> {copiedVideoId === draft.platform ? 'Copied' : 'Copy Flow prompt'}</button><small>Paste this into Google Flow. For a portfolio story, add the project design as a reference image.</small></div>}</section>)}
      <div className="campaign-review-actions"><button className="button button-soft" type="button" onClick={() => { void discardCampaignDrafts(); openCampaign(selectedDate) }}>Generate again</button><button className="button button-dark" type="button" disabled={saving || campaignDrafts.drafts.some((draft) => !draft.caption.trim() || draft.caption.length > (socialPlatforms.find((platform) => platform.id === draft.platform)?.limit || 5000) || (['instagram', 'tiktok', 'youtube'].includes(draft.platform) && !draft.video_prompt.trim()))} onClick={saveCampaign}>{saving ? 'Saving…' : `Save ${campaignDrafts.drafts.length} drafts`} <Check size={15} /></button></div>
    </div></Modal>}
  </main>
}

function CalendarPost({ post, assets, copied, copiedAlt, copiedVideo, copiedImagePrompt, onEdit, onDelete, onCopy, onCopyAlt, onCopyVideo, onCopyImagePrompt, onDownload, onStatus, onUsed }) {
  const asset = assets.find((entry) => entry.id === post.portfolio_asset_id)
  const imageUrl = asset?.url || post.generated_image_url
  const platform = socialPlatforms.find((entry) => entry.id === post.platform)
  const time = post.planned_at ? new Date(post.planned_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''
  return <article className="calendar-post">
    {imageUrl ? <img src={imageUrl} alt={post.generated_image_url ? 'Generated post artwork' : ''} /> : <span className="calendar-post-no-image"><ImagePlus /></span>}
    <div className="calendar-post-body"><header><b>{platformName(post.platform)}</b>{time && <time>{time}</time>}</header><p>{post.caption}</p><div className="calendar-history"><span>{post.content_type === 'educational_solution' ? 'Educational solution' : 'Portfolio story'}</span>{post.copy_count > 0 && <span>Copied {post.copy_count}×</span>}{post.used_at && <span>Used</span>}{post.published_at && <span>Published</span>}</div><label className="calendar-status">Status<select aria-label={`${platformName(post.platform)} post status`} value={post.status} onChange={(event) => onStatus(event.target.value)}>{postStatuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><div className="calendar-post-actions">
      <button className="button button-soft" onClick={onCopy}><Copy size={14} /> {copied ? 'Copied' : 'Copy caption'}</button>
      {post.alt_text && <button className="button button-soft" onClick={onCopyAlt}><Copy size={14} /> {copiedAlt ? 'Alt copied' : 'Copy alt text'}</button>}
      {post.video_generation_prompt && <button className="button button-soft" onClick={onCopyVideo}><Copy size={14} /> {copiedVideo ? 'Copied' : 'Copy Flow prompt'}</button>}
      {post.image_generation_prompt && <button className="button button-soft" onClick={onCopyImagePrompt}><Copy size={14} /> {copiedImagePrompt ? 'Copied' : 'Copy image prompt'}</button>}
      {imageUrl && <button className="button button-soft" onClick={onDownload}><Download size={14} /> Image</button>}
      {!post.used_at && <button className="button button-soft" onClick={onUsed}>Mark used</button>}
      <a className="button button-soft" href={platform?.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
      <button className="icon-button" aria-label="Edit post" onClick={onEdit}><Settings2 size={15} /></button>
      <button className="icon-button" aria-label="Delete post" onClick={onDelete}><X size={15} /></button>
    </div></div>
  </article>
}

function Finance() {
  const { user, workspace, error, setError } = useStudioWorkspace()
  const [invoices, setInvoices] = useState([])
  const [lineItems, setLineItems] = useState([{ description: '', quantity: '1', unit_amount: '' }])
  const [expenses, setExpenses] = useState([])
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [invoiceForm, setInvoiceForm] = useState(false)
  const [expenseForm, setExpenseForm] = useState(false)
  const [manualPaymentInvoice, setManualPaymentInvoice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sharingInvoiceId, setSharingInvoiceId] = useState('')
  const [sharingReceiptId, setSharingReceiptId] = useState('')
  const [deletingInvoiceId, setDeletingInvoiceId] = useState('')
  const [deletingReceiptId, setDeletingReceiptId] = useState('')
  const [deletingExpenseId, setDeletingExpenseId] = useState('')
  const [financeShareMessage, setFinanceShareMessage] = useState('')
  const [printInvoice, setPrintInvoice] = useState(null)
  useEffect(() => {
    if (!supabase || !workspace?.id) return
    Promise.all([
      supabase.from('invoices').select('id, client_id, checkout_token, shared_with_client, number, amount, currency, status, due_date, created_at, clients(name, email, company), invoice_items(id, description, quantity, unit_amount, sort_order), payments(id, amount, status, paid_at, receipts(id, receipt_number, issued_at))').eq('workspace_id', workspace.id).order('sort_order', { referencedTable: 'invoice_items', ascending: true }).order('created_at', { ascending: false }),
      supabase.from('expenses').select('id, description, category, amount, incurred_on').eq('workspace_id', workspace.id).order('incurred_on', { ascending: false }),
      supabase.from('clients').select('id, name').eq('workspace_id', workspace.id).order('name'),
      supabase.from('projects').select('id, name').eq('workspace_id', workspace.id).order('name'),
    ]).then(([invoiceResult, expenseResult, clientResult, projectResult]) => {
      if (invoiceResult.error) setError(invoiceResult.error.message)
      if (expenseResult.error) setError(expenseResult.error.message)
      if (clientResult.error) setError(clientResult.error.message)
      if (projectResult.error) setError(projectResult.error.message)
      setInvoices(invoiceResult.data || [])
      setExpenses(expenseResult.data || [])
      setClients(clientResult.data || [])
      setProjects(projectResult.data || [])
    })
  }, [workspace?.id, setError])
  useEffect(() => {
    if (!supabase || !workspace?.id) return undefined
    const refreshInvoices = async () => {
      const { data, error: invoiceError } = await supabase.from('invoices')
        .select('id, client_id, checkout_token, shared_with_client, number, amount, currency, status, due_date, created_at, clients(name, email, company), invoice_items(id, description, quantity, unit_amount, sort_order), payments(id, amount, status, paid_at, receipts(id, receipt_number, issued_at))')
        .eq('workspace_id', workspace.id)
        .order('sort_order', { referencedTable: 'invoice_items', ascending: true })
        .order('created_at', { ascending: false })
      if (invoiceError) setError(invoiceError.message)
      else setInvoices(data || [])
    }
    const channel = supabase.channel(`finance-payments:${workspace.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'invoices',
        filter: `workspace_id=eq.${workspace.id}`,
      }, refreshInvoices)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'payments',
      }, refreshInvoices)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [workspace?.id, setError])
  async function createInvoice(event) {
    event.preventDefault()
    if (!supabase || !workspace) return
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const parsedItems = lineItems.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_amount: Number(item.unit_amount),
    }))
    if (!parsedItems.length || parsedItems.some((item) => (
      !item.description || item.description.length > 500
      || !Number.isFinite(item.quantity) || item.quantity <= 0
      || !Number.isFinite(item.unit_amount) || item.unit_amount < 0
    ))) {
      setError('Add a description, positive quantity, and valid unit price for every line item.')
      setSaving(false)
      return
    }
    const amount = parsedItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_amount * 100) / 100, 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('The invoice total must be greater than zero.')
      setSaving(false)
      return
    }
    const result = await supabase.rpc('create_studio_invoice', {
      target_workspace: workspace.id,
      target_client: form.client_id || null,
      target_project: form.project_id || null,
      invoice_number: String(form.number).trim(),
      invoice_due_date: form.due_date || null,
      invoice_items: parsedItems,
    })
    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }
    if (form.client_id) {
      const { error: shareError } = await supabase.rpc('set_invoice_client_sharing', {
        target_invoice: result.data,
        should_share: true,
      })
      if (shareError) {
        setError(`Invoice was created but could not be shared with the client: ${shareError.message}`)
        setSaving(false)
        setInvoiceForm(false)
        return
      }
    }
    const invoice = await supabase.from('invoices').select('id, client_id, checkout_token, shared_with_client, number, amount, currency, status, due_date, created_at, clients(name, email, company), invoice_items(id, description, quantity, unit_amount, sort_order), payments(id, amount, status, paid_at, receipts(id, receipt_number, issued_at))').eq('id', result.data).order('sort_order', { referencedTable: 'invoice_items', ascending: true }).single()
    setSaving(false)
    if (invoice.error) setError(invoice.error.message)
    else setInvoices((current) => [invoice.data, ...current])
    setLineItems([{ description: '', quantity: '1', unit_amount: '' }])
    setInvoiceForm(false)
  }
  function openInvoiceForm() {
    setLineItems([{ description: '', quantity: '1', unit_amount: '' }])
    setInvoiceForm(true)
  }
  function updateLineItem(index, field, value) {
    setLineItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }
  async function toggleInvoicePortal(invoice) {
    if (!supabase || !invoice.client_id) return
    setSharingInvoiceId(invoice.id)
    const { error: shareError } = await supabase.rpc('set_invoice_client_sharing', {
      target_invoice: invoice.id,
      should_share: !invoice.shared_with_client,
    })
    setSharingInvoiceId('')
    if (shareError) {
      setError(shareError.message)
      return
    }
    setInvoices((current) => current.map((entry) => entry.id === invoice.id
      ? { ...entry, shared_with_client: !invoice.shared_with_client }
      : entry))
  }
  async function copyCheckoutLink(invoice) {
    if (!supabase) return
    setSharingInvoiceId(invoice.id)
    setFinanceShareMessage('')
    const { data: token, error: tokenError } = await supabase.rpc('create_invoice_checkout_link', {
      target_invoice: invoice.id,
    })
    if (tokenError) {
      setError(tokenError.message)
      setSharingInvoiceId('')
      return
    }
    const checkoutLink = `${window.location.origin}${appPath(`/pay/${token}`)}`
    try {
      await navigator.clipboard.writeText(checkoutLink)
      setFinanceShareMessage(`Checkout link copied for invoice ${invoice.number}. It lets your client choose a deposit or pay the remaining balance.`)
      setInvoices((current) => current.map((entry) => entry.id === invoice.id
        ? { ...entry, checkout_token: token }
        : entry))
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Could not copy the checkout link.')
    }
    setSharingInvoiceId('')
  }
  async function deleteInvoice(invoice) {
    if (!supabase || !workspace || !window.confirm(`Delete invoice #${invoice.number}? Its line items, payment records, and receipts will also be permanently deleted. The income total will be reduced by any recorded payments.`)) return
    setDeletingInvoiceId(invoice.id)
    const { data, error: deleteError } = await supabase.from('invoices').delete()
      .eq('id', invoice.id).eq('workspace_id', workspace.id).select('id')
    setDeletingInvoiceId('')
    if (deleteError) setError(deleteError.message)
    else if (!data?.length) setError('Invoice was not deleted. Refresh the page and check that you still have access to this workspace.')
    else setInvoices((current) => current.filter((entry) => entry.id !== invoice.id))
  }
  async function deleteReceipt(invoice, payment, receipt) {
    if (!supabase || !workspace || !receipt.id) return
    if (!window.confirm(`Delete receipt ${receipt.receipt_number}? The payment record will remain in the income ledger, but the receipt will no longer be available to print or share.`)) return
    setDeletingReceiptId(receipt.id)
    const { data, error: deleteError } = await supabase.from('receipts').delete()
      .eq('id', receipt.id).eq('payment_id', payment.id).select('id')
    setDeletingReceiptId('')
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    if (!data?.length) {
      setError('Receipt was not deleted. Refresh the page and check that it still exists.')
      return
    }
    setInvoices((current) => current.map((entry) => entry.id !== invoice.id ? entry : {
      ...entry,
      payments: asRows(entry.payments).map((entryPayment) => entryPayment.id !== payment.id ? entryPayment : {
        ...entryPayment,
        receipts: asRows(entryPayment.receipts).filter((entryReceipt) => entryReceipt.id !== receipt.id),
      }),
    }))
  }
  async function shareReceipt(invoice, receipt) {
    if (!supabase || !invoice.client_id) {
      setError('This receipt needs an invoice linked to a client before it can be shared.')
      return
    }
    setSharingReceiptId(receipt.receipt_number)
    setFinanceShareMessage('')
    if (!invoice.shared_with_client) {
      const { error: shareError } = await supabase.rpc('set_invoice_client_sharing', {
        target_invoice: invoice.id,
        should_share: true,
      })
      if (shareError) {
        setError(shareError.message)
        setSharingReceiptId('')
        return
      }
      setInvoices((current) => current.map((entry) => entry.id === invoice.id ? { ...entry, shared_with_client: true } : entry))
    }
    const receiptLink = `${window.location.origin}${appPath('/portal')}?receipt=${encodeURIComponent(receipt.receipt_number)}`
    try {
      await navigator.clipboard.writeText(receiptLink)
      setFinanceShareMessage(`Receipt link copied for ${invoice.clients?.name || 'the client'}. The invoice and receipt are now available in their portal.`)
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Could not copy the receipt link. Please copy it from the browser address bar.')
    }
    setSharingReceiptId('')
  }
  async function recordManualPayment(event) {
    event.preventDefault()
    if (!supabase || !manualPaymentInvoice) return
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const amount = Number(form.amount)
    const paymentDate = form.paid_on || new Date().toISOString().slice(0, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid payment amount greater than zero.')
      return
    }
    const { data, error: paymentError } = await supabase.rpc('record_manual_payment', {
      target_invoice: manualPaymentInvoice.id,
      amount_received: amount,
      payment_reference: String(form.reference || '').trim() || `MANUAL-${manualPaymentInvoice.number}`,
      paid_on: new Date(`${paymentDate}T12:00:00`).toISOString(),
      payment_note: String(form.note || '').trim(),
    })
    if (paymentError) {
      setError(paymentError.message)
      return
    }
    const paymentResult = await supabase.from('payments')
      .select('id, amount, status, paid_at, receipts(id, receipt_number, issued_at)')
      .eq('id', data.payment_id).single()
    if (paymentResult.error) setError(`Payment was recorded, but its receipt details could not be loaded: ${paymentResult.error.message}`)
    const recordedPayment = paymentResult.data || {
      id: data.payment_id,
      amount,
      status: 'succeeded',
      paid_at: data.paid_at,
      receipts: [{ receipt_number: data.receipt_number, issued_at: data.paid_at }],
    }
    const invoiceUpdate = {
      ...manualPaymentInvoice,
      status: data?.status || 'paid',
      payments: [...(manualPaymentInvoice.payments || []), recordedPayment],
    }
    setInvoices((current) => current.map((entry) => entry.id === manualPaymentInvoice.id ? invoiceUpdate : entry))
    const receipt = { ...asRows(recordedPayment.receipts)[0], receipt_number: data?.receipt_number, issued_at: data?.paid_at, payment: { amount: String(amount), paid_at: data?.paid_at }, amountPaidToDate: data?.amount_paid }
    setPrintInvoice({ ...invoiceUpdate, receipt })
    setManualPaymentInvoice(null)
  }
  async function createExpense(event) {
    event.preventDefault()
    if (!supabase || !workspace || !user) return
    setSaving(true)
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const result = await supabase.from('expenses').insert({
      workspace_id: workspace.id,
      project_id: form.project_id || null,
      description: String(form.description).trim(),
      category: String(form.category),
      amount: Number(form.amount),
      incurred_on: form.incurred_on,
      created_by: user.id,
    }).select('id, description, category, amount, incurred_on').single()
    setSaving(false)
    if (result.error) setError(result.error.message)
    else setExpenses((current) => [result.data, ...current])
    setExpenseForm(false)
  }
  async function deleteExpense(expense) {
    if (!supabase || !workspace || !window.confirm(`Delete expense "${expense.description}" (${money(Number(expense.amount))})? This will reduce your recorded expenses and update the net total.`)) return
    setDeletingExpenseId(expense.id)
    const { data, error: deleteError } = await supabase.from('expenses').delete()
      .eq('id', expense.id).eq('workspace_id', workspace.id).select('id')
    setDeletingExpenseId('')
    if (deleteError) setError(deleteError.message)
    else if (!data?.length) setError('Expense was not deleted. Refresh the page and check that you still have access to this workspace.')
    else setExpenses((current) => current.filter((entry) => entry.id !== expense.id))
  }
  const totalPaid = invoices.reduce((sum, invoice) => sum + asRows(invoice.payments).filter((payment) => payment.status === 'succeeded').reduce((subtotal, payment) => subtotal + Number(payment.amount), 0), 0)
  const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const receipts = invoices.flatMap((invoice) => asRows(invoice.payments).flatMap((payment) => asRows(payment.receipts).filter((receipt) => receipt?.receipt_number).map((receipt) => ({ receipt, payment, invoice }))))
  return <main className="studio-page">
    <StudioPageHeader kicker="THE BUSINESS / FINANCE" title="Keep the<br />numbers clear." action={<div className="finance-actions"><button className="button button-soft" onClick={() => setExpenseForm(true)}><Plus size={15} /> Expense</button><button className="button button-yellow" disabled={!workspace} onClick={openInvoiceForm}><Plus size={16} /> Create invoice</button></div>} />
    {error && <p className="notice-error">{error}</p>}
    {financeShareMessage && <p className="notice-success">{financeShareMessage}</p>}
    <div className="finance-note"><LockKeyhole size={18} /><div><b>Bachs checkout and manual transfer are enabled.</b><span>Copy an invoice checkout link for external clients or share the invoice in the portal. Bachs-confirmed payments create receipts for both sides, update the balance, and refresh Finance automatically.</span></div></div>
    <div className="dashboard-stats finance-stats"><div><span>INCOME</span><b>{money(totalPaid)}</b></div><div><span>RECORDED EXPENSES</span><b>{money(totalExpenses)}</b></div><div><span>NET (RECORDED)</span><b>{money(totalPaid - totalExpenses)}</b></div></div>
    <div className="studio-section-heading"><div><p className="kicker">STUDIO RECORDS</p><h2>Invoices</h2></div></div>
    {invoices.length ? <div className="record-list">{invoices.map((invoice) => {
      const paid = asRows(invoice.payments).filter((payment) => payment.status === 'succeeded').reduce((sum, payment) => sum + Number(payment.amount), 0)
      const balance = Math.max(Number(invoice.amount) - paid, 0)
      const payable = balance > 0 && ['open', 'overdue'].includes(invoice.status)
      return <div className="record-row" key={invoice.id}><FileText /><div className="record-main"><b>#{invoice.number} · {invoice.clients?.name || 'Client not linked'}</b><span>{money(Number(invoice.amount))} · {invoice.status}</span><small>{money(paid)} received · {money(balance)} remaining</small>{asRows(invoice.payments).flatMap((payment) => asRows(payment.receipts)).filter((receipt) => receipt?.receipt_number).map((receipt) => <small key={receipt.receipt_number}>Verified receipt: {receipt.receipt_number}</small>)}</div><span className="muted-copy">{invoice.due_date || 'No due date'}</span><button className="button button-soft" onClick={() => setPrintInvoice(invoice)}>Print invoice</button>{payable && <><button className="button button-soft" onClick={() => setManualPaymentInvoice(invoice)}>Record payment</button><button className="button button-soft" disabled={sharingInvoiceId === invoice.id} onClick={() => copyCheckoutLink(invoice)}>{sharingInvoiceId === invoice.id ? 'Copying…' : 'Copy checkout link'}</button></>}<button className="button button-soft" disabled={!invoice.client_id || sharingInvoiceId === invoice.id} onClick={() => toggleInvoicePortal(invoice)}>{sharingInvoiceId === invoice.id ? 'Updating…' : invoice.shared_with_client ? 'Remove portal access' : invoice.client_id ? 'Share to client portal' : 'Link a client first'}</button><button className="button button-danger" disabled={deletingInvoiceId === invoice.id} onClick={() => deleteInvoice(invoice)} aria-label={`Delete invoice ${invoice.number}`}>{deletingInvoiceId === invoice.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button></div>
    })}</div> : <div className="studio-empty"><FileText /><h3>No invoices yet.</h3><p>Create an invoice, copy its Bachs checkout link, or record a verified bank transfer. Each confirmed payment issues a receipt and updates the balance.</p><button className="button button-dark" onClick={openInvoiceForm}><Plus size={15} /> Create invoice</button></div>}
    <div className="studio-section-heading"><div><p className="kicker">PAYMENT RECORDS</p><h2>Receipts</h2></div></div>
    {receipts.length ? <div className="record-list">{receipts.map(({ receipt, payment, invoice }) => <article className="record-row" key={receipt.receipt_number}><FileText /><div className="record-main"><b>{receipt.receipt_number} · {invoice.clients?.name || 'Client not linked'}</b><span>Invoice #{invoice.number} · {money(Number(payment.amount))} · {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString() : new Date(receipt.issued_at).toLocaleDateString()}</span><small>{invoice.shared_with_client ? 'Client copy available in portal' : 'Client copy not shared yet'}</small></div><button className="button button-soft" onClick={() => setPrintInvoice({ ...invoice, receipt: { ...receipt, payment } })}>Print studio receipt</button><button className="button button-soft" onClick={() => setPrintInvoice({ ...invoice, receipt: { ...receipt, payment }, receiptAudience: 'client' })}>Print client copy</button><button className="button button-soft" disabled={!invoice.client_id || sharingReceiptId === receipt.receipt_number} onClick={() => shareReceipt(invoice, receipt)}>{sharingReceiptId === receipt.receipt_number ? 'Preparing…' : 'Copy client receipt link'}</button><button className="button button-danger" disabled={!receipt.id || deletingReceiptId === receipt.id} onClick={() => deleteReceipt(invoice, payment, receipt)} aria-label={`Delete receipt ${receipt.receipt_number}`}>{deletingReceiptId === receipt.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button></article>)}</div> : <p className="empty-copy">Receipts generated from verified payments will be stored here.</p>}
    <div className="studio-section-heading"><div><p className="kicker">BUSINESS COSTS</p><h2>Expenses</h2></div></div>
    {expenses.length ? <div className="record-list">{expenses.map((expense) => <div className="record-row" key={expense.id}><span className="project-index index-2"><FileText size={17} /></span><div className="record-main"><b>{expense.description}</b><span>{expense.category} · {expense.incurred_on}</span></div><b>{money(Number(expense.amount))}</b><button className="button button-danger" disabled={deletingExpenseId === expense.id} onClick={() => deleteExpense(expense)} aria-label={`Delete expense ${expense.description}`}>{deletingExpenseId === expense.id ? 'Deleting…' : <><Trash2 size={15} /> Delete</>}</button></div>)}</div> : <p className="empty-copy">Record business costs to calculate net income from real records.</p>}
    {invoiceForm && <Modal title="Create an invoice" onClose={() => setInvoiceForm(false)}><form onSubmit={createInvoice}><label>Invoice number<input name="number" required maxLength="80" placeholder="e.g. GL-001" /></label><label>Client<select name="client_id" defaultValue=""><option value="">No client linked</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label>Project<select name="project_id" defaultValue=""><option value="">No project linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="invoice-line-items"><div className="invoice-line-items-heading"><b>Line items</b><button className="button button-soft" type="button" onClick={() => setLineItems((current) => [...current, { description: '', quantity: '1', unit_amount: '' }])}><Plus size={14} /> Add item</button></div>{lineItems.map((item, index) => <div className="invoice-line-row" key={index}><label>Description<input value={item.description} onChange={(event) => updateLineItem(index, 'description', event.target.value)} maxLength="500" placeholder="Brand identity design" required /></label><label>Qty<input type="number" value={item.quantity} onChange={(event) => updateLineItem(index, 'quantity', event.target.value)} min="0.01" step="0.01" required /></label><label>Unit price<input type="number" value={item.unit_amount} onChange={(event) => updateLineItem(index, 'unit_amount', event.target.value)} min="0" step="0.01" required /></label>{lineItems.length > 1 && <button className="icon-button invoice-line-remove" type="button" aria-label={`Remove line item ${index + 1}`} onClick={() => setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>}</div>)}    <div className="invoice-total-preview"><span>Invoice total</span><b>{money(lineItems.reduce((sum, item) => sum + Math.round((Number(item.quantity) || 0) * (Number(item.unit_amount) || 0) * 100) / 100, 0))}</b></div></div><label>Due date<input name="due_date" type="date" /></label><p className="muted-copy">Invoices linked to a client are shared to their portal automatically. Clients can choose an online deposit or pay the remaining balance using their checkout link.</p><button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Create invoice'} <ArrowRight size={15} /></button></form></Modal>}
    {manualPaymentInvoice && <Modal title={`Confirm payment for invoice ${manualPaymentInvoice.number}`} onClose={() => setManualPaymentInvoice(null)}><form onSubmit={recordManualPayment}><label>Amount received<input name="amount" type="number" required min="0.01" max={invoiceBalance(manualPaymentInvoice)} step="0.01" defaultValue={invoiceBalance(manualPaymentInvoice)} /></label><label>Bank transfer reference<input name="reference" placeholder="Optional transaction reference" maxLength="120" /></label><label>Payment date<input name="paid_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Notes<textarea name="note" rows="3" placeholder="Bank transfer confirmation, account holder, or any matching details." maxLength="500" /></label><p className="muted-copy">This records a successful manual bank transfer and generates a receipt that can be printed and shared with the client.</p><button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Record payment'} <Check size={15} /></button></form></Modal>}
    {expenseForm && <Modal title="Record an expense" onClose={() => setExpenseForm(false)}><form onSubmit={createExpense}><label>Description<input name="description" required maxLength="240" /></label><label>Category<select name="category"><option value="other">Other</option><option value="production">Production</option><option value="software">Software</option><option value="equipment">Equipment</option><option value="travel">Travel</option><option value="contractor">Contractor</option></select></label><label>Project<select name="project_id" defaultValue=""><option value="">Studio-wide</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Amount (NGN)<input name="amount" required type="number" min="0.01" step="0.01" /></label><label>Date<input name="incurred_on" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><button className="button button-dark" disabled={saving}>{saving ? 'Saving…' : 'Save expense'} <ArrowRight size={15} /></button></form></Modal>}
    {printInvoice && <PrintableInvoice invoice={printInvoice} studioName={workspace?.studio_name || 'GLYPH Creative Studio'} studioEmail={workspace?.contact_email || ''} onClose={() => setPrintInvoice(null)} />}
  </main>
}

function pdfCurrency(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
  }).format(amount || 0).replace(/\u00a0/g, ' ')
}

function PrintableInvoice({ invoice, studioName, studioEmail, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const receipt = invoice.receipt
  const items = invoice.invoice_items || []
  const amount = receipt ? Number(receipt.payment?.amount) : Number(invoice.amount)
  const paidToDate = receipt && Number.isFinite(Number(receipt.amountPaidToDate))
    ? Number(receipt.amountPaidToDate)
    : invoicePaid(invoice)
  const balance = Math.max(Number(invoice.amount) - paidToDate, 0)
  const isClientCopy = receipt && invoice.receiptAudience === 'client'
  async function downloadPdf() {
    setDownloading(true)
    setDownloadMessage('')
    setDownloadError('')
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const left = 18
      const right = pageWidth - left
      let y = 22
      const printable = (value) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, ' ')
      const writeWrapped = (value, x, top, maxWidth, lineHeight = 5) => {
        const lines = pdf.splitTextToSize(printable(value), maxWidth)
        if (top + lines.length * lineHeight > pageHeight - 20) {
          pdf.addPage()
          top = 20
        }
        pdf.text(lines, x, top)
        return top + lines.length * lineHeight
      }
      const documentLabel = isClientCopy ? 'PAYMENT CONFIRMATION' : receipt ? 'PAYMENT RECEIPT' : 'INVOICE'
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(18)
      pdf.text(printable(studioName), left, y)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      if (studioEmail) pdf.text(printable(studioEmail), left, y + 6)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.text(documentLabel, right, y, { align: 'right' })
      y += 20
      pdf.setDrawColor(220, 218, 228)
      pdf.line(left, y, right, y)
      y += 10
      pdf.setFontSize(9)
      pdf.setTextColor(100, 96, 112)
      pdf.text(receipt ? 'RECEIPT NUMBER' : 'INVOICE NUMBER', left, y)
      pdf.text('ISSUED', left + 82, y)
      pdf.setTextColor(30, 28, 38)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.text(printable(receipt?.receipt_number || invoice.number), left, y + 6)
      pdf.text(new Date(receipt?.issued_at || invoice.created_at || Date.now()).toLocaleDateString(), left + 82, y + 6)
      y += 23
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100, 96, 112)
      pdf.setFontSize(9)
      pdf.text(isClientCopy ? 'PAID BY' : receipt ? 'RECEIVED FROM' : 'BILLED TO', left, y)
      y += 6
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(30, 28, 38)
      pdf.setFontSize(11)
      pdf.text(printable(invoice.clients?.name || 'Client'), left, y)
      y += 5
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      for (const detail of [invoice.clients?.company, invoice.clients?.email].filter(Boolean)) {
        y = writeWrapped(detail, left, y, right - left, 5)
      }
      if (isClientCopy) {
        y += 5
        pdf.setFont('helvetica', 'bold')
        pdf.text(`PAID TO: ${printable(studioName)}`, left, y)
        y += 6
        if (studioEmail) y = writeWrapped(studioEmail, left, y, right - left, 5)
      }
      y += 7
      pdf.setFillColor(245, 244, 248)
      pdf.rect(left, y - 5, right - left, 9, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.setTextColor(90, 86, 102)
      pdf.text('DESCRIPTION', left + 2, y)
      pdf.text('QTY', left + 99, y, { align: 'right' })
      pdf.text('UNIT PRICE', left + 137, y, { align: 'right' })
      pdf.text('AMOUNT', right - 2, y, { align: 'right' })
      y += 9
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(35, 33, 42)
      for (const item of items) {
        const descriptionLines = pdf.splitTextToSize(printable(item.description), 88)
        const rowHeight = Math.max(descriptionLines.length * 5, 8)
        if (y + rowHeight > pageHeight - 38) {
          pdf.addPage()
          y = 20
        }
        pdf.text(descriptionLines, left + 2, y)
        pdf.text(printable(Number(item.quantity)), left + 99, y, { align: 'right' })
        pdf.text(pdfCurrency(Number(item.unit_amount)), left + 137, y, { align: 'right' })
        pdf.text(pdfCurrency(Number(item.quantity) * Number(item.unit_amount)), right - 2, y, { align: 'right' })
        y += rowHeight
        pdf.setDrawColor(235, 233, 239)
        pdf.line(left, y - 2, right, y - 2)
      }
      y += 5
      const totals = [
        ['INVOICE TOTAL', pdfCurrency(Number(invoice.amount))],
        ['PAID TO DATE', pdfCurrency(paidToDate)],
        ['BALANCE LEFT TO PAY', pdfCurrency(balance)],
        [isClientCopy ? 'AMOUNT YOU PAID' : receipt ? 'AMOUNT RECEIVED' : 'INVOICE TOTAL', pdfCurrency(amount)],
      ]
      const blockHeight = totals.length * 8 + 5
      if (y + blockHeight > pageHeight - 20) {
        pdf.addPage()
        y = 20
      }
      y += 4
      pdf.setDrawColor(220, 218, 228)
      pdf.line(left, y, right, y)
      y += 8
      for (const [label, value] of totals) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor(90, 86, 102)
        pdf.text(label, left, y)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(30, 28, 38)
        pdf.text(value, right, y, { align: 'right' })
        y += 8
      }
      const paidDate = receipt?.payment?.paid_at || receipt?.issued_at
      const footer = receipt
        ? `${isClientCopy ? 'Payment confirmed' : 'Payment received'} · ${pdfCurrency(amount)} on ${paidDate ? new Date(paidDate).toLocaleDateString() : 'the issue date'}. Balance remaining: ${pdfCurrency(balance)}.`
        : 'Please use the payment instructions provided by the studio. Thank you for your business.'
      y = writeWrapped(footer, left, Math.min(y + 8, pageHeight - 25), right - left, 5)
      if (y > pageHeight - 12) {
        pdf.addPage()
        pdf.text(printable(footer), left, 20, { maxWidth: right - left })
      }

      const identifier = receipt?.receipt_number || invoice.number || 'document'
      const filename = `${receipt ? 'Receipt' : 'Invoice'}-${String(identifier).replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`
      const nativeBridge = window.ReactNativeWebView
      if (nativeBridge?.postMessage) {
        const dataUri = pdf.output('datauristring')
        nativeBridge.postMessage(JSON.stringify({
          type: 'glyph.document.download',
          filename,
          data: dataUri.slice(dataUri.indexOf(',') + 1),
        }))
        setDownloadMessage('Opening your mobile PDF save options…')
      } else {
        const url = URL.createObjectURL(pdf.output('blob'))
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.append(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setDownloadMessage(`${receipt ? 'Receipt' : 'Invoice'} PDF downloaded.`)
      }
    } catch (downloadError) {
      setDownloadMessage('')
      setDownloadError(downloadError instanceof Error ? `Could not create the PDF: ${downloadError.message}` : 'Could not create the PDF.')
    } finally {
      setDownloading(false)
    }
  }
  return <div className="print-document-overlay">
    <div className="print-document-actions"><button className="button button-soft" onClick={onClose}>Close</button><button className="button button-dark" onClick={downloadPdf} disabled={downloading}>{downloading ? 'Preparing PDF…' : `Download ${receipt ? 'receipt' : 'invoice'} PDF`} <Download size={15} /></button><button className="button button-soft" onClick={() => window.print()}>Print</button></div>
    {downloadError && <p className="notice-error print-document-download-status" role="alert">{downloadError}</p>}
    {downloadMessage && <p className="print-document-download-status" role="status">{downloadMessage}</p>}
    <article className="print-document">
      <header><div className="print-document-brand"><img src={publicAsset('assets/glyph-logo.jpg')} alt="" /><div><b>{studioName}</b>{studioEmail && <span>{studioEmail}</span>}</div></div><span className="print-document-label">{isClientCopy ? 'PAYMENT CONFIRMATION' : receipt ? 'PAYMENT RECEIPT' : 'INVOICE'}</span></header>
      <div className="print-document-meta"><div><small>{receipt ? 'RECEIPT NUMBER' : 'INVOICE NUMBER'}</small><b>{receipt?.receipt_number || invoice.number}</b></div><div><small>ISSUED</small><b>{new Date(receipt?.issued_at || invoice.created_at || Date.now()).toLocaleDateString()}</b></div>{!receipt && invoice.due_date && <div><small>DUE DATE</small><b>{new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString()}</b></div>}</div>
      <section className="print-document-client"><small>{isClientCopy ? 'PAID BY' : receipt ? 'RECEIVED FROM' : 'BILLED TO'}</small><b>{invoice.clients?.name || 'Client'}</b>{invoice.clients?.company && <span>{invoice.clients.company}</span>}{invoice.clients?.email && <span>{invoice.clients.email}</span>}{isClientCopy && <><small>PAID TO</small><b>{studioName}</b>{studioEmail && <span>{studioEmail}</span>}</>}</section>
      <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{items.map((item) => <tr key={item.id || item.description}><td data-label="Description">{item.description}</td><td data-label="Qty">{Number(item.quantity)}</td><td data-label="Unit price">{money(Number(item.unit_amount))}</td><td data-label="Amount">{money(Number(item.quantity) * Number(item.unit_amount))}</td></tr>)}</tbody></table>
      <div className="print-document-total"><span>{isClientCopy ? 'AMOUNT YOU PAID' : receipt ? 'AMOUNT RECEIVED' : 'INVOICE TOTAL'}</span><b>{money(amount)}</b></div>
      <div className="print-document-balance"><div><span>INVOICE TOTAL</span><b>{money(Number(invoice.amount))}</b></div><div><span>PAID TO DATE</span><b>{money(paidToDate)}</b></div><div><span>BALANCE LEFT TO PAY</span><b>{money(balance)}</b></div></div>
      <footer>{receipt ? isClientCopy
        ? `Payment confirmed · ${invoice.clients?.name || 'Client'} paid ${money(amount)} to ${studioName} on ${receipt.payment?.paid_at ? new Date(receipt.payment.paid_at).toLocaleDateString() : new Date(receipt.issued_at).toLocaleDateString()}. Balance remaining: ${money(balance)}.`
        : `Payment received · ${money(amount)} received from ${invoice.clients?.name || 'Client'} on ${receipt.payment?.paid_at ? new Date(receipt.payment.paid_at).toLocaleDateString() : new Date(receipt.issued_at).toLocaleDateString()}. Balance remaining: ${money(balance)}.`
        : 'Please use the payment instructions provided by the studio. Thank you for your business.'}</footer>
    </article>
  </div>
}

function PublicInvoiceCheckout() {
  const { token } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [percentage, setPercentage] = useState('100')
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [checkingPayment, setCheckingPayment] = useState(new URLSearchParams(window.location.search).get('payment') === 'returned')
  const [paymentMessage, setPaymentMessage] = useState('')
  const [error, setError] = useState('')
  const [printInvoice, setPrintInvoice] = useState(null)

  useEffect(() => {
    let active = true
    let interval
    let initialPaid
    let attempts = 0
    let requestInProgress = false
    const returnedFromCheckout = new URLSearchParams(window.location.search).get('payment') === 'returned'

    const loadInvoice = async (isPoll = false) => {
      if (!supabase || requestInProgress) return
      requestInProgress = true
      const { data, error: requestError } = await supabase.functions.invoke('bachs-checkout', {
        body: { action: 'details', token },
      })
      requestInProgress = false
      if (!active) return
      if (requestError) {
        if (!isPoll) setError(await edgeFunctionError(requestError, 'Could not load this invoice checkout link.'))
        return
      }
      if (!data?.invoice) {
        if (!isPoll) setError('This invoice checkout link is unavailable.')
        return
      }

      setInvoice(data.invoice)
      setLoading(false)
      if (!isPoll) {
        initialPaid = Number(data.invoice.amount_paid)
        if (returnedFromCheckout) {
          const recentReceipt = asRows(data.invoice.receipts).some((receipt) =>
            Date.now() - new Date(receipt.paid_at || receipt.issued_at).getTime() < 10 * 60 * 1000)
          if (recentReceipt) {
            setCheckingPayment(false)
            setPaymentMessage('Bachs confirmed your payment. Your receipt is ready below.')
          }
        }
        return
      }

      const newReceipt = asRows(data.invoice.receipts).some((receipt) =>
        Date.now() - new Date(receipt.paid_at || receipt.issued_at).getTime() < 10 * 60 * 1000)
      if (newReceipt || Number(data.invoice.amount_paid) > initialPaid) {
        setCheckingPayment(false)
        setPaymentMessage('Bachs confirmed your payment. Your receipt is ready below.')
        clearInterval(interval)
      }
    }

    async function loadAndStartPolling() {
      if (!supabase) {
        setError(supabaseConfigMessage)
        setLoading(false)
        return
      }
      await loadInvoice()
      if (active && returnedFromCheckout) {
        interval = window.setInterval(() => {
          attempts += 1
          if (attempts > 20) {
            clearInterval(interval)
            setCheckingPayment(false)
            setPaymentMessage('Payment is not confirmed yet. This page will show your receipt after Bachs verifies the payment.')
            return
          }
          loadInvoice(true)
        }, 3000)
      }
    }

    loadAndStartPolling()
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [token])

  async function startCheckout(event) {
    event.preventDefault()
    if (!supabase || !invoice) return
    setPaying(true)
    setError('')
    const { data, error: checkoutError } = await supabase.functions.invoke('bachs-checkout', {
      body: { action: 'checkout', token, percentage: Number(percentage) },
    })
    setPaying(false)
    if (checkoutError) {
      setError(await edgeFunctionError(checkoutError, 'Bachs checkout could not be started.'))
      return
    }
    if (typeof data?.checkout_url !== 'string') {
      setError(data?.error || 'Bachs did not return a checkout link.')
      return
    }
    window.location.assign(data.checkout_url)
  }

  const amount = invoice
    ? percentage === '100'
      ? Number(invoice.amount_remaining)
      : Math.min(Number(invoice.amount) * Number(percentage) / 100, Number(invoice.amount_remaining))
    : 0
  const clientInvoice = invoice && {
    id: invoice.invoice_id,
    number: invoice.number,
    amount: Number(invoice.amount),
    currency: invoice.currency,
    status: invoice.status,
    created_at: invoice.created_at,
    clients: { name: invoice.client_name, email: invoice.client_email },
    invoice_items: asRows(invoice.items).map((item, index) => ({ ...item, id: `${invoice.invoice_id}-${index}` })),
    payments: asRows(invoice.receipts).map((receipt) => ({
      status: 'succeeded',
      amount: receipt.amount,
      paid_at: receipt.paid_at,
    })),
    receiptAmountPaid: Number(invoice.amount_paid),
  }

  return <div className="public-site">
    <header className="portal-header wrap"><Brand /><span>SECURE INVOICE CHECKOUT</span><Link className="quiet-link" to="/">Back to studio</Link></header>
    <main className="wrap public-checkout">
      {loading ? <p className="loading-copy">Loading invoice…</p> : error && !invoice
        ? <div className="studio-empty"><FileText /><h1>Checkout link unavailable</h1><p>{error}</p></div>
        : invoice && <>
          <p className="kicker">{invoice.studio_name || 'GLYPH Creative Studio'} / INVOICE</p>
          <h1>Invoice <em>#{invoice.number}</em></h1>
          <p className="public-checkout-client">For {invoice.client_name || 'client'} · {invoice.currency}</p>
          <section className="public-checkout-summary">
            {asRows(invoice.items).map((item, index) => <div className="public-checkout-item" key={`${item.description}-${index}`}><span>{item.description} · {Number(item.quantity)} × {money(Number(item.unit_amount))}</span><b>{money(Number(item.quantity) * Number(item.unit_amount))}</b></div>)}
            <div className="public-checkout-total"><span>Invoice total</span><b>{money(Number(invoice.amount))}</b></div>
            <div className="public-checkout-item"><span>Paid to date</span><b>{money(Number(invoice.amount_paid))}</b></div>
            <div className="public-checkout-total"><span>Remaining balance</span><b>{money(Number(invoice.amount_remaining))}</b></div>
          </section>
          {paymentMessage && <p className="notice-success">{paymentMessage}</p>}
          {checkingPayment && <p className="muted-copy">Waiting for Bachs to confirm your payment. Your receipt will appear here as soon as it is verified.</p>}
          {error && invoice && <p className="notice-error">{error}</p>}
          {['open', 'overdue'].includes(invoice.status) && Number(invoice.amount_remaining) > 0
            ? <form className="public-checkout-form" onSubmit={startCheckout}>
              <p className="kicker">CHOOSE YOUR PAYMENT</p>
              <label>Pay now<select value={percentage} onChange={(event) => setPercentage(event.target.value)}>
                <option value="25">25% deposit · {money(Math.min(Number(invoice.amount) * 0.25, Number(invoice.amount_remaining)))}</option>
                <option value="50">50% deposit · {money(Math.min(Number(invoice.amount) * 0.5, Number(invoice.amount_remaining)))}</option>
                <option value="75">75% deposit · {money(Math.min(Number(invoice.amount) * 0.75, Number(invoice.amount_remaining)))}</option>
                <option value="100">100% · Remaining balance · {money(Number(invoice.amount_remaining))}</option>
              </select></label>
              <p className="muted-copy">Deposit percentages are based on the original invoice and capped at the remaining balance. Each confirmed payment generates a receipt showing this payment, the total paid so far, and the balance still due.</p>
              <button className="button button-yellow" disabled={paying || checkingPayment}>{paying ? 'Opening secure checkout…' : `Pay ${money(amount)} with Bachs`} <ArrowRight size={15} /></button>
            </form>
            : Number(invoice.amount_remaining) <= 0
              ? <p className="notice-success">This invoice has been paid in full.</p>
              : <p className="notice-error">This invoice is not currently available for payment. Contact the studio if you think this is a mistake.</p>}
          {asRows(invoice.receipts).length > 0 && <section className="public-checkout-receipts">
            <p className="kicker">PAYMENT RECEIPTS</p>
            {asRows(invoice.receipts).map((receipt) => <div className="public-checkout-receipt" key={receipt.receipt_number}>
              <span><b>{receipt.receipt_number}</b><small>{money(Number(receipt.amount))} · {new Date(receipt.paid_at || receipt.issued_at).toLocaleDateString()}</small></span>
              <button className="button button-soft" onClick={() => setPrintInvoice({
                ...clientInvoice,
                receipt: {
                  receipt_number: receipt.receipt_number,
                  issued_at: receipt.issued_at,
                  payment: { amount: receipt.amount, paid_at: receipt.paid_at },
                  amountPaidToDate: invoice.amount_paid,
                },
                receiptAudience: 'client',
              })}>Print receipt</button>
            </div>)}
          </section>}
        </>}
    </main>
    {printInvoice && <PrintableInvoice invoice={printInvoice} studioName={invoice?.studio_name || 'GLYPH Creative Studio'} studioEmail={invoice?.studio_email || ''} onClose={() => setPrintInvoice(null)} />}
    <SiteFooter />
  </div>
}

function StudioSettings() {
  const { profile, user } = useAuth()
  const { workspace, setWorkspace, error, setError } = useStudioWorkspace()
  const { refreshStudio } = usePublicStudio()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const result = await supabase.from('profiles').upsert({ id: user.id, full_name: String(form.full_name).trim(), updated_at: new Date().toISOString() }).select().single()
    if (result.error) setError(result.error.message)
    else setSaved('Profile updated.')
    setSaving(false)
  }
  async function saveStudio(event) {
    event.preventDefault()
    if (!workspace) return
    setSaving(true)
    setError('')
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const formData = new FormData(event.currentTarget)
    const serviceList = String(form.services).split('\n').map((service) => service.trim()).filter(Boolean)
    const enabledSocialPlatforms = formData.getAll('enabled_social_platforms').map(String)
    if (!serviceList.length || serviceList.length > 12 || serviceList.some((service) => service.length > 80)) {
      setError('Add between 1 and 12 services, each no longer than 80 characters.')
      setSaving(false)
      return
    }
    if (!enabledSocialPlatforms.length || enabledSocialPlatforms.some((platform) => !socialPlatforms.some((entry) => entry.id === platform))) {
      setError('Enable at least one valid social platform.')
      setSaving(false)
      return
    }
    const result = await supabase.from('workspaces').update({
      studio_name: String(form.studio_name).trim(),
      contact_email: String(form.contact_email).trim() || null,
      tagline: String(form.tagline).trim(),
      location: String(form.location).trim(),
      hero_title: String(form.hero_title).trim(),
      hero_subtitle: String(form.hero_subtitle).trim(),
      about_text: String(form.about_text).trim(),
      services: serviceList,
      enabled_social_platforms: enabledSocialPlatforms,
      payment_bank_name: String(form.payment_bank_name || '').trim() || null,
      payment_account_name: String(form.payment_account_name || '').trim() || null,
      payment_account_number: String(form.payment_account_number || '').trim() || null,
      payment_reference_note: String(form.payment_reference_note || '').trim() || null,
      payment_note: String(form.payment_note || '').trim() || null,
      brand_color: String(form.brand_color),
      updated_at: new Date().toISOString(),
    }).eq('id', workspace.id).select('id, studio_name, slug, contact_email, brand_color, tagline, location, hero_title, hero_subtitle, about_text, services, enabled_social_platforms, payment_bank_name, payment_account_name, payment_account_number, payment_reference_note, payment_note').single()
    if (result.error) setError(result.error.message)
    else {
      setWorkspace(result.data)
      await refreshStudio()
      setSaved('Studio details updated.')
    }
    setSaving(false)
  }
  return <main className="studio-page"><StudioPageHeader kicker="PREFERENCES / YOUR STUDIO" title="Make it<br />feel like yours." />{error && <p className="notice-error">{error}</p>}{saved && <p className="notice-success">{saved}</p>}<div className="settings-columns"><form className="settings-panel" onSubmit={saveProfile}><p className="kicker">YOUR ACCOUNT</p><h2>Your details</h2><label>Full name<input name="full_name" defaultValue={profile?.full_name || ''} required maxLength="160" /></label><label>Account email<input value={user?.email || ''} readOnly /></label><button className="button button-dark" disabled={saving}>Save profile</button></form><form key={workspace?.id || 'loading'} className="settings-panel settings-brand-form" onSubmit={saveStudio}><p className="kicker">PUBLIC STUDIO / BRAND</p><h2>Make the site yours</h2><label>Studio name<input name="studio_name" defaultValue={workspace?.studio_name || ''} required maxLength="180" /></label><label>Tagline<input name="tagline" defaultValue={workspace?.tagline || 'INDEPENDENT CREATIVE STUDIO'} required maxLength="120" /></label><label>Your location<input name="location" defaultValue={workspace?.location || 'Lagos & everywhere'} required maxLength="120" /></label><label>Homepage headline<textarea name="hero_title" rows="2" defaultValue={workspace?.hero_title || 'Ideas into\nidentity.'} required maxLength="180" /></label><label>Homepage introduction<textarea name="hero_subtitle" rows="3" defaultValue={workspace?.hero_subtitle || 'We shape brands, images and moving stories for people building something that matters.'} required maxLength="500" /></label><label>About your studio<textarea name="about_text" rows="4" defaultValue={workspace?.about_text || 'GLYPH is an independent creative studio partnering with ambitious people to build thoughtful brands and vivid visual worlds.'} required maxLength="2000" /></label><label>Services (one per line)<textarea name="services" rows="5" defaultValue={(workspace?.services?.length ? workspace.services : services).join('\n')} required /></label><fieldset className="social-platform-settings"><legend>Platforms for AI content</legend><p className="muted-copy">Choose where GLYPH should prepare drafts. Nothing is published automatically.</p><div>{socialPlatforms.map((platform) => <label key={platform.id}><input type="checkbox" name="enabled_social_platforms" value={platform.id} defaultChecked={(workspace?.enabled_social_platforms || socialPlatforms.map(({ id }) => id)).includes(platform.id)} />{platform.label}</label>)}</div></fieldset><label>CONTACT EMAIL<input name="contact_email" type="email" defaultValue={workspace?.contact_email || ''} maxLength="254" /></label><label>Brand accent<input name="brand_color" type="color" defaultValue={workspace?.brand_color || '#2946d8'} /></label><label>Bank name<input name="payment_bank_name" defaultValue={workspace?.payment_bank_name || ''} maxLength="120" /></label><label>Account holder name<input name="payment_account_name" defaultValue={workspace?.payment_account_name || ''} maxLength="160" /></label><label>Account number<input name="payment_account_number" defaultValue={workspace?.payment_account_number || ''} maxLength="32" /></label><label>Reference note<input name="payment_reference_note" defaultValue={workspace?.payment_reference_note || 'Use the invoice number as reference.'} maxLength="160" /></label><label>Optional payment note<textarea name="payment_note" rows="3" defaultValue={workspace?.payment_note || 'Send your transfer confirmation to the studio email after payment.'} maxLength="500" /></label><label>Portfolio address<input value={`${window.location.origin}/portfolio`} readOnly /></label><button className="button button-dark" disabled={saving || !workspace}>{saving ? 'Saving…' : 'Save public site'}</button></form></div><section className="later-features"><p className="kicker">CONNECT WHEN YOU’RE READY</p><div><span>Social account connections & scheduling</span><b>Needs your provider accounts</b></div><div><span>Custom email & community</span><b>Needs sending and hosting setup</b></div><div><span>AI inquiry assistant and quotes</span><b>Needs an approved provider and studio pricing</b></div><div><span>Bachs checkout and manual transfers</span><b>Set up Bachs credentials in Supabase</b></div></section></main>
}

function ClientPortal() {
  const { user } = useAuth()
  const { studio } = usePublicStudio()
  const [projects, setProjects] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [workspacePaymentDetails, setWorkspacePaymentDetails] = useState({})
  const [error, setError] = useState('')
  const unreadMessages = useUnreadProjectMessages(user?.id, setError)
  const [payInvoice, setPayInvoice] = useState(null)
  const [printInvoice, setPrintInvoice] = useState(null)
  const [projectRequestOpen, setProjectRequestOpen] = useState(false)
  const [projectRequestBusy, setProjectRequestBusy] = useState(false)
  const [projectRequestMessage, setProjectRequestMessage] = useState('')
  const [projectRequestService, setProjectRequestService] = useState('')
  const [projectRequestNotice, setProjectRequestNotice] = useState('')
  useEffect(() => {
    if (!supabase || !user?.id) return
    async function loadPortal() {
      const { error: claimError } = await supabase.rpc('claim_client_project_requests')
      if (claimError) setError(claimError.message)
      const { error: accessClaimError } = await supabase.rpc('claim_client_access_by_email')
      if (accessClaimError) {
        setError(accessClaimError.message)
        setProjects([])
        setInvoices([])
        setWorkspacePaymentDetails({})
        return
      }
      const { data: accessRows, error: accessError } = await supabase.from('client_access')
        .select('client_id')
        .eq('user_id', user.id)
      if (accessError) {
        setError(accessError.message)
        setProjects([])
        setInvoices([])
        setWorkspacePaymentDetails({})
        return
      }
      const clientIds = [...new Set((accessRows || []).map((access) => access.client_id).filter(Boolean))]
      if (!clientIds.length) {
        setProjects([])
        setInvoices([])
        setWorkspacePaymentDetails({})
        setError('No client record is linked to this account. Sign in with the confirmed email address the studio used when assigning your invoice.')
        return
      }
      const [projectResult, invoiceResult] = await Promise.all([
        supabase.from('projects').select('id, name, service, status, brief, due_date, workspace_id, client_id, clients(name)').in('client_id', clientIds).eq('share_with_client', true).order('updated_at', { ascending: false }),
        supabase.from('invoices').select('id, workspace_id, client_id, checkout_token, shared_with_client, number, amount, currency, status, due_date, created_at, clients(name, company, email), invoice_items(id, description, quantity, unit_amount, sort_order), payments(id, amount, status, paid_at, receipts(receipt_number, issued_at))').in('client_id', clientIds).eq('shared_with_client', true).order('sort_order', { referencedTable: 'invoice_items', ascending: true }).order('created_at', { ascending: false }),
      ])
      if (projectResult.error) setError(projectResult.error.message)
      if (invoiceResult.error) setError(invoiceResult.error.message)
      setProjects(projectResult.data || [])
      const loadedInvoices = invoiceResult.data || []
      setInvoices(loadedInvoices)
      const paymentDetailResults = await Promise.all(loadedInvoices.map(async (invoice) => {
        const { data, error } = await supabase.rpc('get_client_invoice_payment_details', {
          target_invoice: invoice.id,
        })
        if (error) {
          setError(error.message)
          return [invoice.id, null]
        }
        return [invoice.id, data]
      }))
      setWorkspacePaymentDetails(Object.fromEntries(paymentDetailResults))
      const requestedReceipt = new URLSearchParams(window.location.search).get('receipt')
      if (requestedReceipt) {
        const matchedInvoice = loadedInvoices.find((invoice) => invoice.shared_with_client
          && asRows(invoice.payments).some((payment) => asRows(payment.receipts).some((receipt) => receipt.receipt_number === requestedReceipt)))
        const matchedPayment = asRows(matchedInvoice?.payments).find((payment) => asRows(payment.receipts).some((receipt) => receipt.receipt_number === requestedReceipt))
        const matchedReceipt = asRows(matchedPayment?.receipts).find((receipt) => receipt.receipt_number === requestedReceipt)
        if (matchedInvoice && matchedPayment && matchedReceipt) {
          setPrintInvoice({ ...matchedInvoice, receipt: { ...matchedReceipt, payment: matchedPayment }, receiptAudience: 'client' })
        }
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete('receipt')
        window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
      }
    }
    loadPortal()
  }, [user?.id])
  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let active = true
    const refreshInvoices = async () => {
      const { data: accessRows, error: accessError } = await supabase.from('client_access')
        .select('client_id')
        .eq('user_id', user.id)
      if (accessError) {
        if (active) setError(accessError.message)
        return
      }
      const clientIds = [...new Set((accessRows || []).map((access) => access.client_id).filter(Boolean))]
      if (!clientIds.length) return
      const { data, error: invoiceError } = await supabase.from('invoices')
        .select('id, workspace_id, client_id, checkout_token, shared_with_client, number, amount, currency, status, due_date, created_at, clients(name, company, email), invoice_items(id, description, quantity, unit_amount, sort_order), payments(id, amount, status, paid_at, receipts(receipt_number, issued_at))')
        .in('client_id', clientIds)
        .eq('shared_with_client', true)
        .order('sort_order', { referencedTable: 'invoice_items', ascending: true })
        .order('created_at', { ascending: false })
      if (invoiceError) {
        if (active) setError(invoiceError.message)
        return
      }
      if (active) setInvoices(data || [])
    }
    const channel = supabase.channel(`client-invoices:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'invoices',
      }, refreshInvoices)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'payments',
      }, refreshInvoices)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [user?.id])
  async function acceptInvite(token) {
    const { data, error: rpcError } = await supabase.rpc('accept_client_invitation', { invitation_token: token })
    setError(rpcError ? rpcError.message : data ? 'Invitation accepted. Refresh the page to view shared work.' : 'This invite is invalid, expired, or for another email address.')
    window.history.replaceState({}, '', appPath('/portal'))
  }
  const inviteToken = new URLSearchParams(window.location.search).get('invite')
  useEffect(() => { if (inviteToken && supabase && user?.id) acceptInvite(inviteToken) }, [inviteToken, user?.id])
  async function submitAnotherProject(event) {
    event.preventDefault()
    if (!supabase) return
    setProjectRequestBusy(true)
    setError('')
    const { data: projectId, error: requestError } = await supabase.rpc('submit_client_project_request', {
      request_service: projectRequestService,
      request_message: projectRequestMessage.trim(),
    })
    setProjectRequestBusy(false)
    if (requestError) {
      setError(requestError.message)
      return
    }
    const project = {
      id: projectId,
      name: `${projectRequestService || 'Creative'} project request`,
      service: projectRequestService,
      status: 'inquiry',
      brief: projectRequestMessage.trim(),
      due_date: null,
    }
    setProjects((current) => [project, ...(current || []).filter((item) => item.id !== projectId)])
    setProjectRequestMessage('')
    setProjectRequestService('')
    setProjectRequestOpen(false)
    setProjectRequestNotice('Your project request is with the studio. You can message them from its project card while they review it.')
  }
  return <div className="client-portal">
    <header className="portal-header"><Brand /><span>PROJECT PORTAL</span><button className="quiet-link" onClick={() => supabase.auth.signOut()}><LogOut size={15} /> Sign out</button></header>
    <main className="wrap portal-main">
      <p className="kicker">YOUR SHARED WORK</p><h1>A clear view<br />of the <em>making.</em></h1>
      {error && <p className="notice-error">{error}</p>}
      {projects === null ? <p className="loading-copy">Loading your projects…</p> : projects.length ? <div className="portal-projects">{projects.map((project) => <Link className="portal-card" to={`/portal/project/${project.id}`} key={project.id}><span className="kicker">{project.service || 'CREATIVE PROJECT'}</span>{unreadMessages.counts[project.id] > 0 && <span className="unread-badge portal-unread" aria-label={`${unreadMessages.counts[project.id]} unread messages`}>{unreadMessages.counts[project.id]} new</span>}<h2>{project.name}</h2><p>{project.brief || 'Your studio has shared this project with you.'}</p><span className="portal-status">{project.status.replaceAll('_', ' ')}{project.due_date ? ` · Due ${project.due_date}` : ''}</span><span className="portal-card-chat"><MessageCircle size={15} /> Open project &amp; message your studio</span><ArrowRight size={18} /></Link>)}</div> : <div className="studio-empty"><FolderKanban /><h3>No project shared yet.</h3><p>Your project requests will appear here after you send the Start a project form.</p></div>}
      {projectRequestNotice && <p className="notice-success">{projectRequestNotice}</p>}
      <section className="portal-new-project">
        <div><p className="kicker">A NEW IDEA?</p><h2>Start another project</h2><p>Send the studio a new brief. It will appear in their Requests inbox, and you can message them in the project chat.</p></div>
        {!projectRequestOpen
          ? <button className="button button-dark" onClick={() => { setProjectRequestNotice(''); setProjectRequestOpen(true) }}><Plus size={15} /> Request a project</button>
          : <form onSubmit={submitAnotherProject}>
            <label>What are you looking for?<select required value={projectRequestService} onChange={(event) => setProjectRequestService(event.target.value)}><option value="" disabled>Choose a service</option>{(studio?.services?.length ? studio.services : services).map((service) => <option key={service}>{service}</option>)}<option>Something else</option></select></label>
            <label>Tell us about this project<textarea required minLength="10" maxLength="5000" rows="4" value={projectRequestMessage} onChange={(event) => setProjectRequestMessage(event.target.value)} /></label>
            <div className="portal-new-project-actions"><button className="button button-soft" type="button" disabled={projectRequestBusy} onClick={() => setProjectRequestOpen(false)}>Cancel</button><button className="button button-dark" disabled={projectRequestBusy}>{projectRequestBusy ? 'Sending request…' : 'Send project request'} <Send size={15} /></button></div>
          </form>}
      </section>
      <div className="studio-section-heading portal-invoice-heading"><div><p className="kicker">YOUR ACCOUNT</p><h2>Invoices & receipts</h2></div></div>
      {invoices.length ? <div className="record-list">{invoices.map((invoice) => {
        const paymentRows = asRows(invoice.payments)
        const receiptRows = paymentRows.flatMap((payment) => asRows(payment.receipts).map((receipt) => ({ ...receipt, payment })))
        return <article className="record-row" key={invoice.id}>
          <FileText />
          <div className="record-main">
            <b>Invoice #{invoice.number}</b>
            <span>{money(Number(invoice.amount))} · {invoice.status} · {money(invoicePaid(invoice))} paid · {money(invoiceBalance(invoice))} remaining</span>
            {asRows(invoice.invoice_items).map((item) => <small key={item.id || `${item.description}-${item.sort_order}`}>{item.description} · {Number(item.quantity)} × {money(Number(item.unit_amount))} = {money(Number(item.quantity) * Number(item.unit_amount))}</small>)}
            {receiptRows.map((receipt) => <small key={receipt.receipt_number}>Receipt {receipt.receipt_number} · {new Date(receipt.issued_at).toLocaleDateString()}</small>)}
          </div>
          <button className="button button-soft" onClick={() => setPrintInvoice(invoice)}>Print invoice</button>
          {receiptRows.map((receipt) => <button className="button button-soft" key={receipt.receipt_number} onClick={() => setPrintInvoice({ ...invoice, receipt, receiptAudience: 'client' })}>Print payment confirmation</button>)}
          {['open', 'overdue'].includes(invoice.status) && invoiceBalance(invoice) > 0 && <>
            {invoice.checkout_token && <Link className="button button-yellow" to={`/pay/${invoice.checkout_token}`}>Pay online <ArrowRight size={15} /></Link>}
            <button className="button button-soft" onClick={() => setPayInvoice({ invoice, workspace: workspacePaymentDetails[invoice.id] })}>Bank transfer details</button>
          </>}
        </article>
      })}</div> : <p className="empty-copy">No invoices have been shared with you yet.</p>}
      <p className="config-note">Bachs confirms online payments automatically and issues a receipt for each payment. Your studio can also record a verified manual bank transfer.</p>
    </main>
    <SiteFooter />
    {payInvoice && <Modal title={`Pay ${payInvoice.invoice.number}`} onClose={() => setPayInvoice(null)}><div className="print-document"><p className="kicker">TRANSFER DETAILS</p><p>Transfer {money(Number(payInvoice.invoice.amount))} to the studio account below. Include invoice {payInvoice.invoice.number} as the transfer reference.</p>{payInvoice.workspace?.payment_bank_name ? <><div className="portal-payment-instructions"><b>Bank</b><span>{payInvoice.workspace.payment_bank_name}</span></div><div className="portal-payment-instructions"><b>Account name</b><span>{payInvoice.workspace.payment_account_name || 'Not provided'}</span></div><div className="portal-payment-instructions"><b>Account number</b><span>{payInvoice.workspace.payment_account_number || 'Not provided'}</span></div>{payInvoice.workspace.payment_reference_note && <div className="portal-payment-instructions"><b>Reference note</b><span>{payInvoice.workspace.payment_reference_note}</span></div>}{payInvoice.workspace.payment_note && <div className="portal-payment-instructions"><b>Additional instructions</b><span>{payInvoice.workspace.payment_note}</span></div>}</> : <p className="notice-error">The studio has not added bank transfer details yet. Please message the studio from your project conversation.</p>}<button className="button button-dark" type="button" onClick={() => setPayInvoice(null)}>Close</button></div></Modal>}
    {printInvoice && <PrintableInvoice invoice={printInvoice} studioName={studio?.studio_name || 'GLYPH Creative Studio'} studioEmail={studio?.contact_email || ''} onClose={() => setPrintInvoice(null)} />}
  </div>
}

function ClientProject() {
  const { id } = useParams()
  const { user } = useAuth()
  const { studio } = usePublicStudio()
  const [project, setProject] = useState(null)
  const [notes, setNotes] = useState([])
  const [tasks, setTasks] = useState([])
  const [links, setLinks] = useState([])
  const [feedback, setFeedback] = useState([])
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  useProjectMessageUpdates(id, user?.id, setMessages)
  useEffect(() => {
    if (!supabase || !project?.workspace_id || !user?.id) return
    supabase.from('project_message_reads').upsert({
      workspace_id: project.workspace_id,
      project_id: id,
      user_id: user.id,
      last_read_at: new Date().toISOString(),
    }, { onConflict: 'project_id,user_id' })
      .then(({ error: readError }) => { if (readError) setError(readError.message) })
  }, [id, messages, project?.workspace_id, user?.id])
  useEffect(() => {
    if (!supabase || !user?.id) return
    Promise.all([
      supabase.from('projects').select('id, name, service, brief, due_date, workspace_id, clients(name)').eq('id', id).eq('share_with_client', true).maybeSingle(),
      supabase.from('project_notes').select('id, title, body, kind, created_at').eq('project_id', id).eq('visible_to_client', true).order('created_at', { ascending: false }),
      supabase.from('project_tasks').select('id, title, status, due_date, visible_to_client').eq('project_id', id).eq('visible_to_client', true).order('created_at'),
      supabase.from('project_links').select('id, label, url, kind').eq('project_id', id).eq('visible_to_client', true).order('created_at', { ascending: false }),
      supabase.from('project_feedback').select('*').eq('project_id', id).order('created_at'),
      supabase.from('project_messages').select('*').eq('project_id', id).order('created_at'),
    ]).then(([projectResult, noteResult, taskResult, linkResult, feedbackResult, messageResult]) => {
      const errorResult = [projectResult, noteResult, taskResult, linkResult, feedbackResult, messageResult].find((result) => result.error)
      if (errorResult?.error) setError(errorResult.error.message)
      setProject(projectResult.data)
      setNotes(noteResult.data || [])
      setTasks(taskResult.data || [])
      setLinks(linkResult.data || [])
      setFeedback(feedbackResult.data || [])
      setMessages(messageResult.data || [])
    })
  }, [id, user?.id])
  async function send(event) {
    event.preventDefault()
    const form = event.currentTarget
    const body = new FormData(form).get('body')
    const result = await supabase.from('project_messages').insert({ workspace_id: project.workspace_id, project_id: id, sender_id: user.id, body }).select().single()
    if (result.error) setError(result.error.message)
    else setMessages((current) => [...current, result.data])
    form.reset()
  }
  if (!project) return <div className="public-site"><header className="portal-header"><Brand /><Link to="/portal">Back to projects</Link></header><main className="wrap portal-main">{error ? <p className="notice-error">{error}</p> : <p>Loading your project…</p>}</main></div>
  return <div className="public-site">
    <header className="portal-header"><Brand /><Link to="/portal">Back to projects</Link><button className="quiet-link" onClick={() => supabase.auth.signOut()}><LogOut size={15} /> Sign out</button></header>
    <main className="wrap client-room">
      <p className="kicker">{project.clients?.name || 'YOUR PROJECT'} / CLIENT SPACE</p>
      <h1>{project.name}</h1>
      <p>{project.service || 'Creative project'} · {project.due_date ? `Due ${project.due_date}` : 'No deadline shared'}</p>
      <a className="button button-dark client-message-cta" href="#project-conversation"><MessageCircle size={16} /> Message your studio</a>
      {error && <p className="notice-error">{error}</p>}
      <section className="client-room-block"><p className="kicker">THE BRIEF</p><p>{project.brief || 'Your studio will add project details here.'}</p></section>
      <section className="client-room-block">
        <p className="kicker">SHARED TASK BOARD</p>
        <TaskBoard tasks={tasks} />
      </section>
      <div className="client-room-grid">
        <section className="client-room-block">
          <p className="kicker">SHARED NOTES & DECISIONS</p>
          {notes.length ? notes.map((note) => <article className="note-record" key={note.id}><span className="note-kind">{note.kind}</span><h3>{note.title}</h3><p>{note.body}</p></article>) : <p className="empty-copy">Your studio has not shared notes yet.</p>}
        </section>
        <section className="client-room-block">
          <p className="kicker">FILES & DELIVERABLE REVIEW</p>
          {links.length ? links.map((link) => <article className="deliverable-card" key={link.id}>
            <a className="link-record" href={link.url} target="_blank" rel="noreferrer"><Link2 /><span><b>{link.label}</b><small>{link.kind.replaceAll('_', ' ')}</small></span><ExternalLink /></a>
            <FeedbackThread link={link} entries={feedback.filter((entry) => entry.project_link_id === link.id)} workspaceId={project.workspace_id} projectId={id} userId={user.id} isClient onAdded={(entry) => setFeedback((current) => [...current, entry])} setError={setError} />
          </article>) : <p className="empty-copy">Your studio has not shared files yet.</p>}
        </section>
      </div>
      <section className="client-room-block client-conversation" id="project-conversation">
        <p className="kicker">CHAT WITH YOUR STUDIO</p>
        <p className="conversation-intro">Ask a question, share a decision, or send feedback about this project.</p>
        <div className="conversation-history">{messages.length ? messages.map((message) => <article className={`chat-message ${message.sender_id === user.id ? 'chat-message-own' : 'chat-message-other'}`} key={message.id}><span>{message.sender_id === user.id ? project.clients?.name || 'CLIENT' : studio?.studio_name || 'STUDIO'} · {new Date(message.created_at).toLocaleString()}</span><p>{message.body}</p></article>) : <p className="empty-copy">No messages yet. Start the conversation with your studio below.</p>}</div>
        <form className="chat-form" onSubmit={send}><input name="body" required maxLength="10000" placeholder="Send your studio a message…" /><button className="button button-dark"><Send size={15} /></button></form>
      </section>
    </main>
    <SiteFooter />
  </div>
}

function FeedbackThread({ link, entries, workspaceId, projectId, userId, isClient, onAdded, setError }) {
  async function submit(event) {
    event.preventDefault()
    if (!supabase) return
    const form = event.currentTarget
    const values = new FormData(form)
    const result = await supabase.from('project_feedback').insert({
      workspace_id: workspaceId,
      project_id: projectId,
      project_link_id: link.id,
      author_id: userId,
      kind: isClient ? values.get('kind') : 'studio_response',
      body: values.get('body'),
    }).select().single()
    if (result.error) setError(result.error.message)
    else {
      onAdded(result.data)
      form.reset()
    }
  }
  return <div className="feedback-thread">
    <p className="kicker">{isClient ? 'COMMENTS & REVIEW' : 'CLIENT FEEDBACK'}</p>
    {entries.length ? entries.map((entry) => <article className="feedback-entry" key={entry.id}>
      <span className="note-kind">{entry.author_id === userId ? 'YOU' : isClient ? 'STUDIO' : 'CLIENT'} · {entry.kind.replaceAll('_', ' ')} · {new Date(entry.created_at).toLocaleString()}</span>
      <p>{entry.body}</p>
    </article>) : <p className="empty-copy">No review notes on this file yet.</p>}
    <form className="feedback-form" onSubmit={submit}>
      {isClient && <label>Review<select name="kind" defaultValue="comment"><option value="comment">Leave a comment</option><option value="revision_request">Request a change</option><option value="approved">Approve this file</option></select></label>}
      <label>{isClient ? 'Your feedback' : 'Reply to the client'}<textarea name="body" required maxLength="10000" rows="3" placeholder={isClient ? 'Point out details or describe a change…' : 'Respond with the next step or revision…'} /></label>
      <button className="button button-dark"><Send size={15} /> {isClient ? 'Send review' : 'Reply'}</button>
    </form>
  </div>
}

const taskStatuses = [
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
]

function TaskBoard({ tasks, editable = false, onMove = () => {} }) {
  return <div className="task-board">
    {taskStatuses.map(([status, label]) => {
      const columnTasks = tasks.filter((task) => task.status === status)
      return <section className="task-board-column" key={status}>
        <header><h2>{label}</h2><span>{columnTasks.length}</span></header>
        {columnTasks.length ? columnTasks.map((task) => <article className="task-board-card" key={task.id}>
          <p>{task.title}</p>
          <div><small>{task.due_date ? `Due ${task.due_date}` : 'No deadline'}</small><span className={task.visible_to_client ? 'note-kind note-shared' : 'note-kind'}>{task.visible_to_client ? 'SHARED' : 'PRIVATE'}</span></div>
          {editable && <label className="task-board-status">Move to<select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onMove(task, event.target.value)}>{taskStatuses.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}</select></label>}
        </article>) : <p className="task-board-empty">Nothing here yet.</p>}
      </section>
    })}
  </div>
}

function applyNoteTemplate(event) {
  const form = event.currentTarget.form
  const template = noteTemplates[event.currentTarget.value]
  if (!form || !template) return
  form.elements.namedItem('kind').value = template.kind
  form.elements.namedItem('title').value = template.title
  form.elements.namedItem('body').value = template.body
}

const noteTemplates = {
  brief: {
    kind: 'brief',
    title: 'Project brief',
    body: 'GOAL\n\nAUDIENCE\n\nSCOPE & DELIVERABLES\n\nSTYLE / REFERENCES\n\nSUCCESS LOOKS LIKE\n\nOPEN QUESTIONS',
  },
  meeting: {
    kind: 'meeting',
    title: 'Meeting notes',
    body: 'DATE & ATTENDEES\n\nKEY POINTS\n\nDECISIONS\n\nACTION ITEMS\n\nNEXT CHECK-IN',
  },
  decision: {
    kind: 'decision',
    title: 'Decision record',
    body: 'DECISION\n\nCONTEXT\n\nOPTIONS CONSIDERED\n\nWHY THIS WAS CHOSEN\n\nIMPACT / NEXT STEPS',
  },
  delivery: {
    kind: 'note',
    title: 'Delivery checklist',
    body: '[ ] Final files exported\n[ ] File formats and sizes checked\n[ ] Spelling and details reviewed\n[ ] Client approval received\n[ ] Delivery links tested\n[ ] Source files archived',
  },
}

function StudioPageHeader({ kicker, title, action }) {
  const [first, second] = title.split('<br />')
  return <div className="studio-page-head"><div><p className="kicker">{kicker}</p><h1>{first}<br /><em>{second}</em></h1></div>{action}</div>
}

function EmptyRecord({ title, text, onCreate }) {
  return <div className="studio-empty"><span className="empty-icon">✳</span><h3>{title}</h3><p>{text}</p><button className="button button-dark" onClick={onCreate}><Plus size={15} /> Create new</button></div>
}

function Modal({ title, onClose, children }) {
  return <div className="modal-shade" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><header><div><p className="kicker">GLYPH / STUDIO</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header>{children}</section></div>
}

function RecordForm({ onSubmit, children }) {
  return <form className="inline-record-form" onSubmit={onSubmit}>{children}</form>
}

function money(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(amount || 0)
}

function asRows(value) {
  if (value == null) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

function invoicePaid(invoice) {
  return asRows(invoice?.payments)
    .filter((payment) => payment.status === 'succeeded')
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
}

function invoiceBalance(invoice) {
  return Math.max(Number(invoice?.amount || 0) - invoicePaid(invoice), 0)
}

async function edgeFunctionError(error, fallback) {
  if (error?.context && typeof error.context.clone === 'function') {
    try {
      const body = await error.context.clone().json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      return error.message || fallback
    }
  }
  return error?.message || fallback
}

function MobileStudioTheme() {
  const location = useLocation()
  useEffect(() => {
    const from = typeof location.state?.from === 'string'
      ? new URL(location.state.from, window.location.origin)
      : null
    const requestedByRoute = new URLSearchParams(location.search).get('app') === 'mobile'
    const requestedByRedirect = from?.searchParams.get('app') === 'mobile'
    const mobileMode = requestedByRoute || requestedByRedirect
      || window.sessionStorage.getItem('glyph-studio-mobile-app') === 'true'
    if (mobileMode) window.sessionStorage.setItem('glyph-studio-mobile-app', 'true')
    document.documentElement.classList.toggle('mobile-studio-theme', mobileMode)
  }, [location.pathname, location.search, location.state])
  return null
}

function RouteScrollReset() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    const root = document.documentElement
    const previousBehavior = root.style.scrollBehavior
    root.style.scrollBehavior = 'auto'
    window.scrollTo(0, 0)
    root.style.scrollBehavior = previousBehavior
  }, [pathname])
  return null
}

function App() {
  return <BrowserRouter basename={appBasePath || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RouteScrollReset /><MobileStudioTheme /><AuthProvider><PublicStudioProvider><Routes>
    <Route path="/" element={<PublicHome />} />
    <Route path="/portfolio" element={<Portfolio />} />
    <Route path="/portfolio/:slug" element={<PortfolioDetail />} />
    <Route path="/contact" element={<Contact />} />
    <Route path="/sign-in" element={<AuthPage />} />
    <Route path="/create-account" element={<AuthPage signup />} />
    <Route path="/pay/:token" element={<PublicInvoiceCheckout />} />
    <Route path="/studio/*" element={<ProtectedRoute><StudioAccessRoute /></ProtectedRoute>} />
    <Route path="/portal" element={<ProtectedRoute><ClientPortal /></ProtectedRoute>} />
    <Route path="/portal/project/:id" element={<ProtectedRoute><ClientProject /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></PublicStudioProvider></AuthProvider></BrowserRouter>
}

createRoot(document.getElementById('root')).render(<App />)
