import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useOutline } from '@/hooks/useOutline'
import { allNodes, currentPath, isParent, pathNums } from '@/lib/outline'
import { scrollToNode } from '@/lib/sticky'
import type { OutlineNode } from '@/types'
import { OutlineTab, type OpenNodes } from './OutlineTab'
import { Rail } from './Rail'
import { TopBar, type TabName } from './TopBar'

/** One outline: its tabs, kept up to date as the agent edits the file, without reloading. */
export function OutlinePage({ project, file }: { project: string; file: string }) {
    const { state, viewer, patch } = useOutline(project, file)
    const [tab, setTab] = useState<TabName>('outline')
    const open: OpenNodes = viewer.open
    const outline = state.status === 'ready' || state.status === 'gone' ? state.outline : null

    useEffect(() => {
        document.title = outline?.title || file
    }, [outline?.title, file])

    const onToggle = useCallback((node: OutlineNode, value: boolean) => patch({ open: { [node.num]: value } }), [patch])
    const setAll = (value: boolean) => {
        if (!outline) return
        patch({ open: Object.fromEntries(allNodes(outline.nodes).filter(n => isParent(n) || n.level === 1).map(n => [n.num, value])) })
    }
    /** Opens the way to a node (and a topic itself), then scrolls it to the top, below the headers above it. */
    const reveal = (num: string) => {
        flushSync(() => {
            setTab('outline')
            patch({ open: Object.fromEntries(pathNums(num).slice(0, num.includes('.') ? -1 : undefined).map(n => [n, true])) })
        })
        const el = document.querySelector(`.outline-tab [data-num="${CSS.escape(num)}"]`)
        if (el) setTimeout(() => scrollToNode(el), 0)
    }
    const current = outline ? [...currentPath(outline.nodes)].pop() : undefined

    if (!outline)
        return (
            <main className="mx-auto max-w-[860px] p-8 text-muted-foreground">
                {state.status === 'missing' ? (
                    <p>
                        There is no outline {project}/{file}. <a className="underline" href="/">All outlines</a>
                    </p>
                ) : (
                    <p>Loading…</p>
                )}
            </main>
        )
    return (
        <Tabs value={tab} onValueChange={v => setTab(v as TabName)} className="block pl-[76px]">
            <Rail />
            <TopBar outline={outline} tab={tab} onExpandAll={() => setAll(true)} onCollapseAll={() => setAll(false)} onJump={current ? () => reveal(current) : undefined} />
            {state.status === 'gone' && (
                <p role="status" className="mx-auto mt-4 max-w-[860px] rounded-md border border-danger/40 px-4 py-2 text-sm text-danger">
                    This outline was moved or deleted. What you see is its last version.
                </p>
            )}
            <TabsContent value="outline" forceMount hidden={tab !== 'outline'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <OutlineTab outline={outline} open={open} onToggle={onToggle} />
            </TabsContent>
            <TabsContent value="md" forceMount hidden={tab !== 'md'} className="mx-auto max-w-[900px] px-5 pt-4 pb-20">
                <div className="markdown" dangerouslySetInnerHTML={{ __html: outline.markdown }} />
            </TabsContent>
        </Tabs>
    )
}
