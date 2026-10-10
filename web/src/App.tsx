import { LivePage } from '@/components/LivePage'
import { OutlineList } from '@/components/OutlineList'
import { OutlinePage } from '@/components/OutlinePage'

/**
 * The app. Until the cutover it is served under /app/: the outline list at /app/, an outline at
 * /app/<project>/<file>, and a session just started at /app/live?t=<tmux session> (docs/plans/viewer-spa.md).
 */
export function App() {
    const [project, file] = location.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    if (project === 'live' && !file) return <LivePage terminal={new URLSearchParams(location.search).get('t') ?? ''} />
    if (project && file) return <OutlinePage project={project} file={file} />
    return <OutlineList />
}
