import { LivePage } from '@/components/LivePage'
import { OutlineList } from '@/components/OutlineList'
import { OutlinePage } from '@/components/OutlinePage'

/** The app: the outline list at /, an outline at /<project>/<file>, and a session just started at /live?t=<tmux session>. */
export function App() {
    const [project, file] = location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (project === 'live' && !file) return <LivePage terminal={new URLSearchParams(location.search).get('t') ?? ''} />
    if (project && file) return <OutlinePage project={project} file={file} />
    return <OutlineList />
}
