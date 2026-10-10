/** A JSON request to the server; a refusal throws with the server's own error. */
export async function api<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    let data: unknown
    try {
        data = await res.json()
    } catch {
        data = {}
    }
    if (!res.ok) {
        const err = new Error((data as { error?: string }).error || res.statusText) as Error & { data?: unknown }
        err.data = data
        throw err
    }
    return data as T
}

/** The page for a session just started: its terminal in the main area, until the outline's first version is written. */
export const liveHref = (terminal: string) => `/live?t=${encodeURIComponent(terminal)}`

/** The app's page for an outline. */
export const outlineHref = (project: string, file: string) => `/${encodeURIComponent(project)}/${encodeURIComponent(file)}`
