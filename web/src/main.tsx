import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/theme.css'
import './styles/vault.css'
import './styles/desktop.css'
import { DesktopSetup } from './components/DesktopSetup'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopSetup />
  </React.StrictMode>,
)
