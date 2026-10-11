// Links that open the Outline app: `outline-only://open/<project>/<file>`. The skill prints them when the app wrote
// its link base into the settings file; macOS hands a clicked one to the app, starting it if needed.

/** The app's URL scheme. The built app declares it in its Info.plist (bin/build-app.js). */
export const SCHEME = 'outline-only'

/** What the app writes as the settings file's `linkBase`: the skill appends `/<project>/<file>`. */
export const LINK_BASE = `${SCHEME}://open`

// As the server names outlines: no path separators, no dot files.
const safeName = name => name !== '' && !name.startsWith('.') && !/[/\\]/.test(name)

/**
 * The page path a link opens: `/<project>/<file>` for `outline-only://open/<project>/<file>`, and undefined for any
 * other link. The project is in the path, not the host: URL parsers lowercase hosts, and project names have capitals.
 */
export function pagePathOf(link) {
    let url
    try {
        url = new URL(link)
    } catch {
        return undefined
    }
    if (url.protocol !== `${SCHEME}:` || url.host.toLowerCase() !== 'open') return undefined
    const parts = url.pathname.split('/').slice(1)
    if (parts.length !== 2) return undefined
    try {
        const names = parts.map(decodeURIComponent)
        return names.every(safeName) ? `/${names.map(encodeURIComponent).join('/')}` : undefined
    } catch {
        return undefined
    }
}
