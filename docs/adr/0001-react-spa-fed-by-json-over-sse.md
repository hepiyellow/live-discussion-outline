# The page is a React single-page app fed by JSON over SSE

The page was one HTML string built by `renderPage`, with about 340 lines of CSS and 630 lines of inline script, and it reloaded itself on every outline edit. Scroll restore, stored open/closed state and the unread diff existed mostly to survive that reload. We are replacing it with a single-page app: on each change, the server pushes the parsed outline as JSON over SSE, and a React + Vite + TypeScript client re-renders only the nodes that changed. The client is styled with shadcn/ui on Tailwind v4 and built on install. The same page is the window content of the Outline app, which is built on Electron.

## Decisions

- **Structure as JSON, prose as HTML.** Anything the page acts on (nodes, statuses, queue items, transcript entries, messages) is a typed JSON object. Markdown inside it is rendered to HTML by the server, the only markdown renderer, and carried in an `html` field. The transcript stream sends typed entries (`assistant-text`, `user-text`, `tool-use`, `tool-result`, `title`) instead of ready-made HTML. The Markdown tab is one `html` field in the outline payload.
- **The terminal stays a byte stream** over its WebSocket into xterm.js.
- **Build on install.** A `prepare` script runs `vite build` during `npm install`, and the server serves the build. In development, Vite runs as middleware inside the server. Nothing built is committed. This ends the "npm install builds nothing" promise.
- **One fixed port** from the settings file, in the browser and in the Outline app alike, because per-viewer state lives in `localStorage`, which is scoped by origin (port included).
- **Port feature by feature.** The new app is served at a new path, and the old page stays at `/` until the new one reaches parity.

## Considered Options

- **Vue 3 or Svelte 5** instead of React. Both would fit the "patch one node" updates well, but they have smaller ecosystems and coding agents, who write most of this code, are less reliable with them (Svelte 5's runes especially).
- **Preact + htm with no build step.** It would keep `npm install` build-free, but it offers no type checking and only postpones the build decision.
- **Committing the built files.** It would avoid a build on install, at the cost of noisy diffs and stale builds.
- **Radix Themes, Mantine, or hand-written CSS** instead of shadcn/ui. shadcn/ui's components live in the repo and are themed by CSS variables, which is the shortest path to a neutral look like the Claude and ChatGPT desktop apps.
- **Tauri** instead of Electron. Its apps are smaller, but the Node server would ship as a sidecar binary, and the page would run in Safari's engine in the app and in Chromium outside it.

## Consequences

Parts of the page that change the DOM directly (the unread-diff animation, the stacking of sticky headers, xterm) work through a ref on an element whose children React does not manage. A node's body is server HTML inserted with `dangerouslySetInnerHTML`, so the diff animation can rewrite it word by word without React undoing it.
