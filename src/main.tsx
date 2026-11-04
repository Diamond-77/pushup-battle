import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getPoseLandmarker } from './pose'

// Start downloading the pose model right away (during login etc.) so the camera screen is ready sooner.
getPoseLandmarker().catch(() => {})

// ?demo opens the how-to-play demo on its own, without signing in (for testing it)
const HowToPlay = lazy(() => import('./demo/HowToPlay'))
const params = new URLSearchParams(location.search)
const demo = params.has('demo')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {demo ? (
      <main className="app"><div className="screen"><Suspense fallback={null}><HowToPlay first={Number(params.get('step')) || 0} onDone={() => location.reload()} /></Suspense></div></main>
    ) : (
      <App />
    )}
  </StrictMode>,
)
