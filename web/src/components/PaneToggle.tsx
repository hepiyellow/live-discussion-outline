import { useState } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

const KEY = 'outlines-pane-hidden'
const root = document.documentElement

// Whether the viewer hid the pane, in this browser; a convenience only, so a failure leaves it shown.
try {
    if (localStorage.getItem(KEY) === '1') root.dataset.pane = 'hidden'
} catch {}

/**
 * The start of every top bar: the sidebar icon, which shows or hides the outlines pane, the page moving over to make room.
 * While the pane shows, this part is as wide as the pane and in its colours, so the pane reads as reaching the top of
 * the window, and what follows in the bar starts where the main area does (index.css).
 */
export function PaneToggle() {
    const [hidden, setHidden] = useState(root.dataset.pane === 'hidden')
    return (
        <div data-pane-head className="-mb-px mr-2 flex w-(--pane-w) shrink-0 items-center self-stretch border-r bg-sidebar px-2">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={hidden ? 'Show the outlines pane' : 'Hide the outlines pane'}
                aria-pressed={!hidden}
                title={hidden ? 'Show the outlines pane' : 'Hide the outlines pane'}
                onClick={() => {
                    const next = !hidden
                    if (next) root.dataset.pane = 'hidden'
                    else delete root.dataset.pane
                    try {
                        localStorage.setItem(KEY, next ? '1' : '0')
                    } catch {}
                    setHidden(next)
                }}
            >
                <PanelLeft />
            </Button>
        </div>
    )
}
