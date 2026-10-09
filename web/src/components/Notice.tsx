import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Notify = (text: string, error?: boolean) => void

const NoticeCtx = createContext<Notify>(() => {})

/** Shows a short notice (what was sent, copied or undone) that slides in at the bottom right for two seconds. */
export const useNotify = () => useContext(NoticeCtx)

export function NoticeProvider({ children }: { children: ReactNode }) {
    const [notice, setNotice] = useState<{ text: string; error: boolean; id: number } | null>(null)
    const [shown, setShown] = useState(false)
    const timer = useRef<number>(undefined)
    const notify = useCallback<Notify>((text, error = false) => {
        setNotice({ text, error, id: Date.now() })
        setShown(true)
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setShown(false), 2000)
    }, [])
    return (
        <NoticeCtx.Provider value={notify}>
            {children}
            <div
                id="notice"
                role="status"
                title={notice?.text}
                data-shown={shown || undefined}
                className={cn(
                    'pointer-events-none fixed right-16 bottom-3 z-[100] max-w-[min(520px,calc(100vw-180px))] truncate rounded-lg px-3.5 py-2 text-[13px] shadow-lg transition-all duration-300',
                    notice?.error ? 'bg-danger text-white' : 'bg-foreground text-background',
                    shown ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+84px)] opacity-0',
                )}
            >
                {notice?.text}
            </div>
        </NoticeCtx.Provider>
    )
}
