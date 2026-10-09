#!/usr/bin/env node
// Spike: a Claude Code channel that lets a local web page send messages into
// a running session. Claude Code spawns this over stdio; it also serves
// http://127.0.0.1:8788 with an input box. Replies stream back over SSE.
// stdout belongs to MCP, so log to stderr only.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const PORT = Number(process.env.OUTLINE_CHANNEL_PORT || 8788)

// Claude Code gives its MCP servers the session id. Title and model come from
// the session transcript, an internal format that may change.
const SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID || ''
const PROJECTS = path.join(os.homedir(), '.claude', 'projects')

function findTranscript() {
  if (!SESSION_ID) return null
  for (const dir of fs.readdirSync(PROJECTS)) {
    const file = path.join(PROJECTS, dir, `${SESSION_ID}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return null
}

function sessionInfo() {
  const info = { sessionId: SESSION_ID, cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), title: null, model: null }
  const file = findTranscript()
  if (!file) return info
  let customTitle = null, aiTitle = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'custom-title') customTitle = e.customTitle
    else if (e.type === 'ai-title') aiTitle = e.aiTitle
    else if (e.type === 'attachment' && e.attachment?.type === 'model') info.model = e.attachment.identity?.marketingName || e.attachment.identity?.modelId
    else if (e.type === 'assistant' && e.message?.model && e.message.model !== '<synthetic>') info.modelId = e.message.model
  }
  info.title = customTitle || aiTitle
  return info
}

const listeners = new Set()
function broadcast(event) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`
  for (const res of listeners) res.write(chunk)
}

const mcp = new Server(
  { name: 'outline', version: '0.0.1' },
  {
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions:
      'Messages from the discussion-outline web page arrive as <channel source="outline" msg_id="...">. ' +
      'Treat each as the user speaking in this conversation. ' +
      'When done, call the reply tool with the msg_id and a short answer so it shows on the page.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Show a reply on the discussion-outline web page',
    inputSchema: {
      type: 'object',
      properties: {
        msg_id: { type: 'string', description: 'The msg_id from the inbound <channel> tag' },
        text: { type: 'string', description: 'The reply to show' },
      },
      required: ['msg_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`)
  const { msg_id, text } = req.params.arguments
  broadcast({ kind: 'reply', msg_id, text })
  return { content: [{ type: 'text', text: 'sent' }] }
})

await mcp.connect(new StdioServerTransport())
// When the Claude session exits, stdin closes; exit too so the port is freed.
process.stdin.on('end', () => process.exit(0))

const PAGE = `<!doctype html><meta charset="utf-8"><title>Outline channel spike</title>
<style>body{font:15px system-ui;max-width:640px;margin:2rem auto;padding:0 16px}
#log div{padding:6px 8px;margin:4px 0;border-radius:6px}.me{background:#e8f0fe}.cl{background:#eee}
form{display:flex;gap:8px}input{flex:1;padding:8px}#info{color:#555;font-size:13px;margin:-8px 0 16px}</style>
<h3 id=title>Send to the Claude session</h3><div id=info>Connecting…</div>
<form id=f><input id=t autofocus placeholder="Type a message"><button>Send</button></form><div id=log></div>
<script>
const log=document.getElementById('log'),t=document.getElementById('t')
async function info(){try{const i=await (await fetch('/info')).json()
document.getElementById('title').textContent=i.title||'Untitled session'
document.getElementById('info').textContent=[i.model||i.modelId||'model unknown',i.cwd,'session '+i.sessionId].join(' · ')
}catch{document.getElementById('info').textContent='Session not running'}}
info();setInterval(info,5000)
const add=(c,s)=>{const d=document.createElement('div');d.className=c;d.textContent=s;log.prepend(d)}
new EventSource('/events').onmessage=e=>{const m=JSON.parse(e.data);add('cl','Claude ['+m.msg_id+']: '+m.text)}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();if(!t.value)return
const r=await fetch('/send',{method:'POST',body:t.value});const {msg_id}=await r.json();add('me','You ['+msg_id+']: '+t.value);t.value=''}
</script>`

let nextId = 1
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE)
  } else if (req.method === 'GET' && req.url === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(sessionInfo()))
  } else if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.write(': connected\n\n')
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
  } else if (req.method === 'POST' && req.url === '/send') {
    let body = ''
    for await (const chunk of req) body += chunk
    const msg_id = String(nextId++)
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: { content: body, meta: { msg_id } },
    })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ msg_id }))
  } else {
    res.writeHead(404).end()
  }
}).listen(PORT, '127.0.0.1', () => console.error(`outline channel on http://127.0.0.1:${PORT}`))
