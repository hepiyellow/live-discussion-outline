import { useEffect, useState } from 'react'
import type { OutlineList } from '@/types'

/**
 * The outline list, kept up to date as outlines are written, renamed or moved, from its own stream. Only for pages
 * that hold no outline stream: an outline's page gets the list on its outline's stream (useOutline).
 */
export function useOutlineList() {
    const [list, setList] = useState<OutlineList | null>(null)
    useEffect(() => {
        const es = new EventSource('/api/outlines/events')
        es.onmessage = e => setList(JSON.parse(e.data) as OutlineList)
        return () => es.close()
    }, [])
    return list
}
