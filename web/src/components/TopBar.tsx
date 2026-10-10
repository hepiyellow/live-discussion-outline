import { useState } from 'react'
import { Check, Copy, Crosshair, FileText, Folder, ListCollapse, ListTree, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Outline } from '@/types'
import { ModelPicker } from './ModelPicker'

export type TabName = 'outline' | 'md'

interface Props {
    outline: Outline
    tab: TabName
    onExpandAll: () => void
    onCollapseAll: () => void
    /** Undefined when the outline has no @current node. */
    onJump?: () => void
    undoSteps: number
    onUndo: () => void
}

/** The copy button for the `Resume:` line: the link or command that reopens the chat. */
function ResumeCopy({ resume }: { resume: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <Button
            variant="ghost"
            size="icon-sm"
            title={`Copy the link that reopens this chat: ${resume}`}
            aria-label="Copy the link that reopens this chat"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(resume)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1200)
                } catch {}
            }}
        >
            {copied ? <Check /> : <Copy />}
        </Button>
    )
}

/** The bar over every tab: the tabs, the Outline tab's tools, then the project, model and resume link. */
export function TopBar({ outline, tab, onExpandAll, onCollapseAll, onJump, undoSteps, onUndo }: Props) {
    return (
        <header data-topbar className="sticky top-0 z-20 flex h-11 items-center gap-1 border-b bg-background px-4 whitespace-nowrap">
            <TabsList className="mr-2">
                <TabsTrigger value="outline" title="The collapsible outline">
                    <ListTree /> Outline
                </TabsTrigger>
                <TabsTrigger value="md" title="The plain rendered markdown">
                    <FileText /> Markdown
                </TabsTrigger>
            </TabsList>
            {tab === 'outline' && (
                <>
                    <Button variant="ghost" size="icon-sm" title="Expand all" aria-label="Expand all" onClick={onExpandAll}>
                        <ListTree />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Collapse all" aria-label="Collapse all" onClick={onCollapseAll}>
                        <ListCollapse />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Jump to the current node" aria-label="Jump to the current node" disabled={!onJump} onClick={onJump}>
                        <Crosshair />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Undo your last approval"
                        title={undoSteps ? `Undo your last approval (${undoSteps} step${undoSteps === 1 ? '' : 's'}, ⌘Z)` : 'Nothing to undo'}
                        disabled={!undoSteps}
                        onClick={onUndo}
                    >
                        <Undo2 />
                    </Button>
                </>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-3 text-sm text-muted-foreground">
                {outline.project && (
                    <span className="inline-flex min-w-0 items-center gap-1.5" title={`Project: ${outline.project}${outline.folder ? `\nWorking folder: ${outline.folder}` : ''}`}>
                        <Folder className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{outline.project}</span>
                    </span>
                )}
                <ModelPicker outline={outline} />
                {outline.resume && <ResumeCopy resume={outline.resume} />}
            </div>
        </header>
    )
}

