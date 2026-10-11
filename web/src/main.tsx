import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { NoticeProvider } from './components/Notice'

// In the Outline app the window has no title bar, and the top bar leaves room for the window buttons (index.css).
document.documentElement.toggleAttribute('data-app', /\bElectron\//.test(navigator.userAgent))

// A page older than the last build asks for script chunks that are gone (a build renames them), and what loads them
// later, such as the Terminal tab, stays empty. Loading the page again gets the chunks of now; once a minute at most,
// so a chunk that is really missing does not reload the page for ever.
addEventListener('vite:preloadError', event => {
    const KEY = 'outline-only:reloaded-for-chunk'
    if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 60_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
    event.preventDefault()
    location.reload()
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <NoticeProvider>
            <App />
        </NoticeProvider>
    </StrictMode>,
)
