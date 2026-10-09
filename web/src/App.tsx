import { OutlinePage } from '@/components/OutlinePage'

/**
 * The app. Until the cutover it is served at /app/<project>/<file>, beside the old page at /<project>/<file>
 * (docs/plans/viewer-spa.md).
 */
export function App() {
    const [project, file] = location.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    if (project && file) return <OutlinePage project={project} file={file} />
    return (
        <main className="mx-auto max-w-2xl p-8">
            <h1 className="text-lg font-semibold">Outlines</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                The list of outlines is not rebuilt yet: see the{' '}
                <a className="underline underline-offset-4 hover:text-foreground" href="/">
                    current page
                </a>
                .
            </p>
        </main>
    )
}
