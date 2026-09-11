import { useState } from 'react'
import { api } from '../api/client'
import type { Bin } from '../api/types'
import { IconBin, IconClose, IconCopy, IconDownload, IconPremiere, IconTrash } from './Icons'

/* ---------------------------------------------------------------------------
   Saved bins. A bin is a named set of clips you can open in the ledger, add
   to, hand to Premiere, or export as an XML that File > Import turns into a
   bin with those clips in it.
   --------------------------------------------------------------------------- */

type Props = {
  bins: Bin[]
  activeBin: string | null
  bridge: boolean
  onOpen: (id: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onClose: () => void
  onToast: (msg: string, kind?: 'ok' | 'warn' | 'err') => void
}

export function BinsPanel({ bins, activeBin, bridge, onOpen, onRename, onDelete, onClose, onToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState<string | null>(null)

  const send = async (b: Bin) => {
    setSending(b.id)
    try {
      await api.binToPremiere(b.id)
      onToast(`Sent “${b.name}” to Premiere`)
    } catch (err) {
      const e = err as { message: string; extra?: { paths?: string[] } }
      onToast(`Premiere bridge: ${e.message}`, 'err')
    } finally {
      setSending(null)
    }
  }

  const copyPaths = async (b: Bin) => {
    try {
      const res = await fetch(api.binPathsUrl(b.id))
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      onToast(`${b.count} path${b.count === 1 ? '' : 's'} copied — paste into Premiere's import dialog`)
    } catch {
      onToast('Could not copy paths', 'err')
    }
  }

  return (
    <div className="bins card" role="dialog" aria-label="Saved bins">
      <header className="bins__head">
        <IconBin size={16} />
        <span className="title">Bins</span>
        <span className="bins__count dt">{bins.length}</span>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close bins">
          <IconClose size={15} />
        </button>
      </header>

      {bins.length === 0 ? (
        <p className="bins__empty">
          No bins yet. Check some clips in the ledger and press <kbd>B</kbd>, or use “Add to bin” on a clip.
        </p>
      ) : null}

      <ul className="bins__list">
        {bins.map((b) => (
          <li key={b.id} className={`bin${activeBin === b.id ? ' is-open' : ''}`}>
            <div className="bin__covers" aria-hidden="true">
              {b.cover_ids.slice(0, 3).map((id) => (
                <img key={id} src={`/media/frame/${id}.jpg`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
              ))}
            </div>
            <div className="bin__body">
              {editing === b.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (draft.trim() && draft.trim() !== b.name) onRename(b.id, draft.trim())
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="bin__rename"
                />
              ) : (
                <button
                  type="button"
                  className="bin__name"
                  onClick={() => onOpen(activeBin === b.id ? null : b.id)}
                  onDoubleClick={() => {
                    setDraft(b.name)
                    setEditing(b.id)
                  }}
                  title="Open in the ledger · double-click to rename"
                >
                  {b.name}
                </button>
              )}
              <span className="bin__meta dt">{b.count} clip{b.count === 1 ? '' : 's'}</span>
            </div>
            <div className="bin__ops">
              {bridge ? (
                <button type="button" className="btn btn--icon" title="Send to Premiere" disabled={sending === b.id || b.count === 0} onClick={() => void send(b)}>
                  <IconPremiere size={15} />
                </button>
              ) : null}
              <a className="btn btn--icon" title="Download Premiere XML (File › Import creates the bin)" href={api.binExportUrl(b.id)} download>
                <IconDownload size={15} />
              </a>
              <button type="button" className="btn btn--icon" title="Copy file paths" onClick={() => void copyPaths(b)}>
                <IconCopy size={15} />
              </button>
              <button type="button" className="btn btn--icon btn--danger" title="Delete bin" onClick={() => onDelete(b.id)}>
                <IconTrash size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
