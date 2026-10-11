import { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { api, outlineApiPath } from '@/lib/api'
import type { Outline, PermissionPrompt as Prompt } from '@/types'
import { useNotify } from './Notice'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

const BUTTON = 'rounded-md border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50'

/**
 * A permission prompt of the outline's session, as a pop-up: Claude Code is about to use a tool and asks first. The
 * terminal shows the same prompt, and whichever is answered first counts. Allow and Deny answer it here. Closing the
 * pop-up answers nothing: the prompt stays the terminal's, and a message in the inbox says so. With several prompts
 * waiting the oldest shows, and the next one follows it.
 */
export function PermissionPrompt({ outline, prompts }: { outline: Outline; prompts: Prompt[] }) {
    const notify = useNotify()
    const [busy, setBusy] = useState('')
    const prompt = prompts[0]
    if (!prompt) return null
    const answer = async (what: 'allow' | 'deny' | 'dismiss') => {
        if (busy) return
        setBusy(prompt.id)
        try {
            const { ok } = await api<{ ok: boolean }>(`/api/outline/${outlineApiPath(outline.project, outline.file)}/permission`, { id: prompt.id, answer: what })
            if (!ok && what !== 'dismiss') notify('That prompt was already answered', true)
        } catch (e) {
            notify(`Not sent: ${(e as Error).message}`, true)
        }
        setBusy('')
    }
    return (
        <Dialog open onOpenChange={open => !open && answer('dismiss')}>
            <DialogContent data-permission={prompt.id} className="flex max-h-[85vh] max-w-2xl flex-col gap-3">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldQuestion className="size-5 shrink-0 text-danger" aria-hidden="true" />
                        Allow {prompt.tool}?
                    </DialogTitle>
                    <DialogDescription>
                        The session asks for your permission before it uses this tool. It waits until you answer, here or in its terminal.
                        {prompts.length > 1 && ` ${prompts.length - 1} more ${prompts.length === 2 ? 'prompt waits' : 'prompts wait'} after this one.`}
                    </DialogDescription>
                </DialogHeader>
                {prompt.summary && <p className="text-[14px] font-medium break-words">{prompt.summary}</p>}
                <pre data-permission-input className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[12px] whitespace-pre-wrap break-words">
                    {prompt.input}
                </pre>
                <DialogFooter className="gap-2">
                    <button type="button" className={`${BUTTON} hover:bg-accent`} disabled={!!busy} onClick={() => answer('deny')}>
                        Deny
                    </button>
                    <button type="button" className={`${BUTTON} border-transparent bg-claim text-white hover:opacity-90`} disabled={!!busy} onClick={() => answer('allow')} autoFocus>
                        Allow
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
