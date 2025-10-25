import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import VCFEstimator from "./VCFEstimator";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen bg-background">
      <VCFEstimator />
    </div>
  </StrictMode>,
)
