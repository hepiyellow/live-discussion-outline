import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { NoticeProvider } from './components/Notice'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <NoticeProvider>
            <App />
        </NoticeProvider>
    </StrictMode>,
)
