import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { NoticeProvider } from './components/Notice'

// In the Outline app the window has no title bar, and the top bar leaves room for the window buttons (index.css).
document.documentElement.toggleAttribute('data-app', /\bElectron\//.test(navigator.userAgent))

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <NoticeProvider>
            <App />
        </NoticeProvider>
    </StrictMode>,
)
