import { useState } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

const KEY = 'outlines-pane-hidden'
const root = document.documentElement

// Whether the viewer hid the pane, in this browser; a convenience only, so a failure leaves it shown.
try {
    if (localStorage.getItem(KEY) === '1') root.dataset.pane = 'hidden'
} catch {}

/** The sidebar icon at the left of every top bar: shows or hides the outlines pane, the page moving over to make room. */
export function PaneToggle() {
    const [hidden, setHidden] = useState(root.dataset.pane === 'hidden')
    return (
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
    )
}
