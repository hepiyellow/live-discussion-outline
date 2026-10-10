/** Types a message into the linked session's terminal, through the server's /send: the one way the page messages the session. */
export async function sendToSession(terminal: string, text: string) {
    const res = await fetch('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terminal, text }) })
    if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

/** Stops the turn the linked session's agent is in, through the server's /stop (Escape in its terminal). */
export async function stopSession(terminal: string) {
    const res = await fetch('/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ terminal }) })
    if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

/** Copies text to the clipboard; false when the browser refuses. */
export async function copyText(text: string) {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
