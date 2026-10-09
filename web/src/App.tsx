/**
 * The app shell. Until the cutover it is served at /app/<project>/<file>, beside the old page at /<project>/<file>;
 * later steps fill it in (ADR 0001, docs/plans/viewer-spa.md).
 */
export function App() {
    const [project, file] = location.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const old = project && file ? `/${encodeURIComponent(project)}/${encodeURIComponent(file)}` : '/'
    return (
        <main className="mx-auto max-w-2xl p-8 font-sans">
            <h1 className="text-lg font-semibold">{project && file ? `${project} / ${file}` : 'Outlines'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                This page is being rebuilt. Until it is done, use the{' '}
                <a className="underline underline-offset-4 hover:text-foreground" href={old}>
                    current page
                </a>
                .
            </p>
        </main>
    )
}
