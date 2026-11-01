import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getPoseLandmarker } from './pose'

// Start downloading the pose model right away (during login etc.) so the camera screen is ready sooner.
getPoseLandmarker().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
