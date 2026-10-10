import { useEffect, useRef } from 'react'
import type { Outline } from '@/types'
import '@xterm/xterm/css/xterm.css'

/**
 * The Terminal tab: the linked session's terminal, live, through xterm.js on the /term WebSocket (a tmux client the
 * server runs). xterm is loaded the first time the tab opens, and draws into a ref'd element React leaves alone.
 */
export function TerminalTab({ outline, active, opened }: { outline: Outline; active: boolean; opened: boolean }) {
    const box = useRef<HTMLDivElement>(null)
    const term = useRef<{ focus: () => void; fit: () => void } | null>(null)

    // Created the first time the tab opens; kept attached while other tabs show, until the page goes.
    useEffect(() => {
        if (!opened || !outline.terminalTab) return
        let disposed = false
        let cleanup = () => {}
        ;(async () => {
            const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
            if (disposed || !box.current) return
            const t = new Terminal({ fontFamily: 'Menlo,Monaco,"SF Mono",monospace', fontSize: 13, cursorBlink: true, allowProposedApi: true, theme: { background: '#0d1117' } })
            const fit = new FitAddon()
            t.loadAddon(fit)
            t.open(box.current)
            fit.fit()
            let ws: WebSocket | null = null
            const send = (m: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))
            const connect = () => {
                const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/term?s=${encodeURIComponent(outline.terminal)}&cols=${t.cols}&rows=${t.rows}`
                const socket = new WebSocket(url)
                ws = socket
                socket.onmessage = e => t.write(e.data)
                socket.onclose = () => {
                    if (ws !== socket) return
                    t.write(`\r\n\x1b[2m[not attached to tmux session ${outline.terminal}. Is it running? Press any key to retry.]\x1b[0m\r\n`)
                    ws = null
                }
            }
            t.onData(d => {
                if (!ws) return connect()
                send({ t: 'i', d })
            })
            t.onResize(({ cols, rows }) => send({ t: 'r', c: cols, r: rows }))
            const ro = new ResizeObserver(() => box.current?.offsetParent && fit.fit())
            ro.observe(box.current)
            connect()
            t.focus()
            term.current = { focus: () => t.focus(), fit: () => fit.fit() }
            cleanup = () => {
                ro.disconnect()
                const socket = ws
                ws = null
                socket?.close()
                t.dispose()
                term.current = null
            }
        })()
        return () => {
            disposed = true
            cleanup()
        }
    }, [opened, outline.terminalTab, outline.terminal])

    // Back on the tab: fit the terminal to the window as it is now, and type into it.
    useEffect(() => {
        if (!active || !term.current) return
        term.current.fit()
        term.current.focus()
    }, [active])

    if (!outline.terminalTab)
        return (
            <p className="text-muted-foreground">
                {outline.terminal ? (
                    <>The terminal can't be shown: the server couldn't load node-pty (see the server log). The input box can still type into tmux {outline.terminal}.</>
                ) : (
                    <>
                        This outline's session isn't running in tmux. Start the agent with <code>tmux new -s &lt;name&gt; claude</code> and run the skill; it adds a{' '}
                        <code>Terminal:</code> line, and this tab shows that session's live terminal.
                    </>
                )}
            </p>
        )
    return <div ref={box} data-terminal className="fixed top-[var(--barh)] right-0 bottom-0 left-(--pane-w) bg-[#0d1117] pt-1.5 pl-2" />
}
