import { useState } from 'react'
import { Check, ChevronDown, Copy, Crosshair, Folder, ListCollapse, ListTree, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Outline, TabName } from '@/types'
import { PaneToggle } from './PaneToggle'


interface Props {
    outline: Outline
    tab: TabName
    onTab: (t: TabName) => void
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

/** The bar over every tab: the session's name, the Outline tab's tools, then the project, resume link and the tab dropdown. */
export function TopBar({ outline, tab, onTab, onExpandAll, onCollapseAll, onJump, undoSteps, onUndo }: Props) {
    return (
        <header data-topbar className="sticky top-0 z-40 -ml-(--pane-w) flex h-11 items-center gap-1 border-b bg-background px-2 whitespace-nowrap">
            <PaneToggle />
            <span className="mr-2 min-w-0 max-w-[40%] truncate text-sm font-medium" title={outline.title || outline.file}>
                {outline.title || outline.file}
            </span>
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
                {outline.resume && <ResumeCopy resume={outline.resume} />}
                <span className="relative inline-flex items-center">
                    <select
                        aria-label="View"
                        title="Switch between the outline, markdown, transcript and terminal"
                        className="appearance-none rounded-md border bg-background py-[3px] pr-6 pl-2 text-[13px] text-foreground"
                        value={tab}
                        onChange={e => onTab(e.target.value as TabName)}
                    >
                        <option value="outline">Outline</option>
                        <option value="md">Markdown</option>
                        <option value="transcript" disabled={!outline.session}>
                            Transcript
                        </option>
                        <option value="term" disabled={!outline.terminalTab}>
                            Terminal
                        </option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5" aria-hidden="true" />
                </span>
            </div>
        </header>
    )
}

