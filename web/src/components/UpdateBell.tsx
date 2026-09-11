import { useEffect, useRef, useState } from 'react'
import { IconBell } from './Icons'
type Release = { state: string; available: boolean; current_version: string; latest_version?: string; release_url: string; installer_available?: boolean }

export function UpdateBell() {
  const [release, setRelease] = useState<Release | null>(null)
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  async function check() {
    setChecking(true)
    try {
      const response = await fetch('/api/updates')
      if (!response.ok) throw new Error('Update check failed')
      setRelease(await response.json())
    } catch { setRelease(current => ({ current_version: current?.current_version ?? '', release_url: current?.release_url ?? '', state: 'unavailable', available: false })) }
    finally { setChecking(false) }
  }
  useEffect(() => { void check(); const timer = window.setInterval(() => void check(), 15 * 60 * 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  function openRelease(e: React.MouseEvent<HTMLAnchorElement>) {
    if (window.pywebview && release) { e.preventDefault(); void window.pywebview.api.open_releases(release.release_url) }
  }
  const message = release?.available ? 'Update available' : release?.state === 'current' ? 'You’re up to date' : release?.state === 'no_releases' ? 'No releases published yet' : release?.state === 'disabled' ? 'Update checks are off' : release?.state === 'unavailable' ? 'Could not check for updates' : 'Checking for updates…'
  return <div className="update-bell" ref={ref} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }}>
    <button type="button" className={`btn btn--quiet${release?.available ? ' update-bell--available' : ''}`} aria-expanded={open} aria-controls="vault-updates" aria-label={release?.available ? 'Notifications: update available' : 'Notifications and updates'} onClick={() => setOpen(!open)}>
      <IconBell size={18} />{release?.available && <><span className="update-dot" /><span>Update available</span></>}
    </button>
    {open && <section id="vault-updates" className="update-popover" aria-label="Application updates">
      <p className="setup-eyebrow">APP UPDATES</p><h2 role="status">{message}</h2>
      {release?.current_version && <p>Installed: {release.current_version}</p>}
      {release?.available && <p>Version {release.latest_version} is ready. The installer relaunches Vault after the update.</p>}
      {release?.available && !release.installer_available && <p>This release has no Windows installer attached yet.</p>}
      <div className="setup-actions">
        {release?.release_url && <>
          {release.available && release.installer_available && <a className="btn btn--warm" href={release.release_url} onClick={openRelease} target="_blank" rel="noreferrer">Download</a>}
          <a className="btn" href={release.release_url} onClick={openRelease} target="_blank" rel="noreferrer">Learn more</a>
        </>}
        <button className="btn btn--quiet" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check again'}</button>
      </div>
    </section>}
  </div>
}
