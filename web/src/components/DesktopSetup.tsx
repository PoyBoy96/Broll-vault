import { useEffect, useState } from 'react'
import { App } from '../App'
import { UpdateBell } from './UpdateBell'

export type DesktopBridge = {
  choose_folder: () => Promise<string | null>
  choose_catalog: () => Promise<string | null>
  open_releases: (url: string) => Promise<void>
  restart: () => Promise<void>
}
declare global { interface Window { pywebview?: { api: DesktopBridge } } }

type Settings = { media_root: string; catalog_path: string; cache_path: string; preview_policy: string; primary_editor: string; check_updates: boolean }
type SetupInfo = { configured: boolean; settings: Settings; default_cache: string }

export function DesktopSetup() {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [restart, setRestart] = useState(false)
  const [native, setNative] = useState(Boolean(window.pywebview))
  useEffect(() => {
    const ready = () => setNative(true)
    window.addEventListener('pywebviewready', ready)
    return () => window.removeEventListener('pywebviewready', ready)
  }, [])
  async function load() {
    try {
      const response = await fetch('/api/setup')
      if (!response.ok) throw new Error('Reopen Vault from its desktop shortcut or local launch link.')
      setInfo(await response.json())
      setError('')
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load() }, [])
  const change = (key: keyof Settings, value: string | boolean) => setInfo(current => current ? { ...current, settings: { ...current.settings, [key]: value } } : null)
  async function pick(kind: 'root' | 'catalog' | 'cache') {
    try {
      const bridge = window.pywebview?.api
      if (!bridge) return
      const path = await (kind === 'catalog' ? bridge.choose_catalog() : bridge.choose_folder())
      if (!path) return
      change(kind === 'root' ? 'media_root' : kind === 'catalog' ? 'catalog_path' : 'cache_path', path)
      if (kind === 'root' && !info?.settings.catalog_path) change('catalog_path', path.replace(/[\\/]$/, '') + '\\_CATALOG\\broll_catalog.sqlite')
    } catch { setError('The folder picker could not open. Enter the path directly.') }
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info?.settings) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message || 'Setup could not be saved')
      if (result.restart_required) setRestart(true)
      else { await load(); setEditing(false) }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  if (info?.configured && !editing) return <App onSetup={() => { setEditing(true); setStep(1) }} />
  const settings = info?.settings
  return <main className="setup-shell">
    <header className="setup-header"><span className="brand__mark" aria-hidden="true" /><strong>B-roll Vault</strong><UpdateBell /></header>
    <section className="setup-card" aria-labelledby="setup-title">
      <p className="setup-eyebrow">{editing ? 'SETUP & CONNECTIONS' : 'WELCOME TO YOUR LIBRARY'}</p>
      <h1 id="setup-title">{restart ? 'Your settings are saved.' : step === 0 ? 'Find the shot. Keep the original.' : step === 1 ? 'Connect your footage library.' : 'Ready to make it yours.'}</h1>
      {error && <p role="alert" className="setup-error">{error}</p>}
      {!info ? <button className="btn" onClick={() => void load()}>Reconnect</button> : restart ? <>
        <p>Restart Vault to use the new settings. Your footage stays where it is.</p>
        {native ? <button className="btn btn--warm" onClick={() => void window.pywebview?.api.restart()}>Restart Vault</button> : <p>Close the local server and open Vault again.</p>}
      </> : step === 0 ? <>
        <p>Search, preview, collect, and send clips to your editor. Vault keeps your original footage in place.</p>
        <p>Your library paths and preferences stay on this computer. Nothing is preconfigured for another workstation.</p>
        <button className="btn btn--warm" onClick={() => setStep(1)}>Set up Vault</button>
      </> : <form onSubmit={e => { e.preventDefault(); if (step === 1) setStep(2); else void save() }}>
        {step === 1 ? <>
          <label> B-roll library folder
            <span className="setup-path"><input required value={settings!.media_root} onChange={e => change('media_root', e.target.value)} placeholder="Choose the folder containing your original footage" />{native && <button type="button" className="btn" onClick={() => void pick('root')}>Browse</button>}</span>
          </label>
          <label>Catalog database
            <span className="setup-path"><input required value={settings!.catalog_path} onChange={e => change('catalog_path', e.target.value)} placeholder="Choose your existing SQLite catalog" />{native && <button type="button" className="btn" onClick={() => void pick('catalog')}>Browse</button>}</span>
          </label>
          <p className="setup-note">Vault reads your existing catalog. If it lives elsewhere, choose it directly. No media scan starts automatically.</p>
          <label>Local cache folder
            <span className="setup-path"><input value={settings!.cache_path} onChange={e => change('cache_path', e.target.value)} placeholder={info.default_cache} />{native && <button type="button" className="btn" onClick={() => void pick('cache')}>Browse</button>}</span>
          </label>
        </> : <>
          <dl className="setup-receipt"><dt>Library</dt><dd>{settings!.media_root}</dd><dt>Catalog</dt><dd>{settings!.catalog_path}</dd><dt>Local cache</dt><dd>{settings!.cache_path || info.default_cache}</dd></dl>
          <label>Preview behavior<select value={settings!.preview_policy} onChange={e => change('preview_policy', e.target.value)}><option value="existing">Existing previews only</option><option value="stills">Stills only</option><option value="on_demand">On-demand motion previews</option></select></label>
          <p className="setup-note">Generating previews requires FFmpeg on this computer. Search and bins work without it.</p>
          <label>Primary editor<select value={settings!.primary_editor} onChange={e => change('primary_editor', e.target.value)}><option value="ask">Ask each time</option><option value="premiere">Premiere Pro</option><option value="resolve">DaVinci Resolve</option></select></label>
          <label className="setup-check"><input type="checkbox" checked={settings!.check_updates} onChange={e => change('check_updates', e.target.checked)} />Check GitHub Releases for updates</label>
          <p className="setup-note">The bell announces new releases. Download opens GitHub; installing the update relaunches Vault.</p>
        </>}
        <footer className="setup-actions">
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>
          {editing && <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => { setEditing(false); void load() }}>Cancel</button>}
          <button className="btn btn--warm" disabled={busy}>{busy ? 'Validating library and cache…' : step === 1 ? 'Continue' : editing ? 'Save settings' : 'Validate & open Vault'}</button>
        </footer>
      </form>}
    </section>
    <p className="setup-footnote">Originals stay in place. Settings stay on this computer.</p>
  </main>
}
