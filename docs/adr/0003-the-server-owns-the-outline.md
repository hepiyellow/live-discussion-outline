# The server owns the outline; agents change it through MCP tools

_For a transition, the old way is kept beside this one: an outline is in **server mode** (what this ADR decides) or in **file mode** (the agent writes the file, as before), chosen when its session starts and written in the file as a `Mode: server` line. The server never writes an outline in file mode, and the tools and hooks pass it over. So the first consequence below does not hold for now: an agent without the tools can still feed the page by writing a file. One mode is to be retired; [the plan](../plans/two-modes.md) says how._

The agent used to write the outline as a markdown file, following a long skill, and the server watched the folder. The skill could only ask for what an outline needs (unique numbers, one current node, roll-up, a queue kept up to date), and an approval on the page stayed pending until the agent copied it into the file. We are making the server the only writer: an agent changes an outline through three MCP tools (`start`, `read`, `change`), the user through the page, and each learns from the server what the other did. [The plan](../plans/outline-over-mcp.md) has the reasoning and the measurements.

## Decisions

- **The file stays markdown, and is storage only.** The page's reader, the node history and every existing outline keep working without a migration. No agent reads or writes it.
- **One `change` call carries a list of operations, applied together or not at all.** There is no write of the whole outline. A refused change names the operation, the reason and what to do.
- **An approval is state.** A tick on the page is written into the outline at once. The agent is not woken for it: it is told with the user's next prompt (a hook) and in every tool result. Only a press of Run reaches the agent right away, typed into its session terminal when it has one.
- **An approval covers the wording the user saw.** When the agent rewrites an approved node, the server makes it a claim again. The claim is kept under an approval, so taking an approval back returns a claim to a claim.
- **A stale update is refused.** An update to a node whose text is not what the server last showed this agent comes back with the current text. After compaction or resume every node counts as unseen.
- **Numbers stay dense.** A new node takes the next free number under its parent; a removed or moved node closes the gap behind it, and a moved node takes the next number under its new parent. The result lists the numbers that changed.
- **The plugin runs on Node's own modules.** An installed plugin is a copy of its folder without `node_modules`, so its MCP process speaks the protocol itself and passes every call to the server over HTTP.
- **The plugin starts the server when none is running**, as the skill's ensure step did, although ADR 0002 says only the app does. An agent that cannot reach a server cannot keep an outline at all now.

## Considered Options

- **Keep the agent writing the file, and have a hook check it after each write.** Much of the correctness for far less change, but approvals would not be state and two writers would remain.
- **JSON as storage.** Simpler to write back, but every existing outline and the page's reader would need migrating, for something no agent sees.
- **Waking the agent on every approval** (the channel, or a line typed into its terminal). The agent could object at once, but most approvals need no answer and each would cost a turn.

## Consequences

An agent without the plugin can no longer feed the page by writing a file: the server would still show the file, but nothing tells such an agent what the user ticked. Numbers that change under a move or a removal also change in what the page keeps by number (open nodes, what was read, the node history). The Claude Code channel, which could wake an idle session, is not used yet. Codex is untested: its MCP configuration is standard, its hooks and plugin layout are unverified.
