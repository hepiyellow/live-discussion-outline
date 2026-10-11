# The server owns the outline; agents change it through MCP tools

_For a transition, the old way is kept beside this one: an outline is in **server mode** (what this ADR decides) or in **file mode** (the agent writes the file, as before), chosen when its session starts and written in the file as a `Mode: server` line. The server never writes an outline in file mode, and the tools and hooks pass it over. So the first consequence below does not hold for now: an agent without the tools can still feed the page by writing a file. One mode is to be retired; [the plan](../plans/two-modes.md) says how._

The agent used to write the outline as a markdown file, following a long skill, and the server watched the folder. The skill could only ask for what an outline needs (unique numbers, one current node, roll-up, a queue kept up to date), and an approval on the page stayed pending until the agent copied it into the file. We are making the server the only writer: an agent changes an outline through three MCP tools (`start`, `read`, `change`), the user through the page, and each learns from the server what the other did. [The plan](../plans/outline-over-mcp.md) has the reasoning and the measurements.

## Decisions

- **The file stays markdown, and is storage only.** The page's reader, the node history and every existing outline keep working without a migration. No agent reads or writes it.
- **One `change` call carries a list of operations, applied together or not at all.** There is no write of the whole outline. A refused change names the operation, the reason and what to do.
- **An approval is state, and the agent is told of it once the user pauses.** A tick on the page is written into the outline at once. About five seconds after the user's last tick, the server types one line into the agent's session terminal for the whole run of ticks, and the prompt hook hands over what was ticked. A message the user sends within the pause takes the ticks along, and nothing is typed. A session without a session terminal is told with the user's next prompt (the hook) and in every tool result. A press of Run is typed at once. _Until October 2026 the agent was not woken for a tick at all. In use, an approval that closed a plan then sat unanswered until the user wrote about something else, so the agent could not take the step the approval opened._
- **An approval covers the wording the user saw.** When the agent rewrites an approved node, the server makes it a claim again. The claim is kept under an approval, so taking an approval back returns a claim to a claim.
- **A stale update is refused.** An update to a node whose text is not what the server last showed this agent comes back with the current text. After compaction or resume every node counts as unseen.
- **Numbers stay dense.** A new node takes the next free number under its parent; a removed or moved node closes the gap behind it, and a moved node takes the next number under its new parent. The result lists the numbers that changed.
- **The plugin runs on Node's own modules.** An installed plugin is a copy of its folder without `node_modules`, so its MCP process speaks the protocol itself and passes every call to the server over HTTP.
- **The plugin starts the server when none is running**, as the skill's ensure step did, although ADR 0002 says only the app does. An agent that cannot reach a server cannot keep an outline at all now.

## Considered Options

- **Keep the agent writing the file, and have a hook check it after each write.** Much of the correctness for far less change, but approvals would not be state and two writers would remain.
- **JSON as storage.** Simpler to write back, but every existing outline and the page's reader would need migrating, for something no agent sees.
- **Waking the agent on every single tick.** The agent could answer at once, but a run of approvals would cost a turn each. Waiting for a pause makes a run one turn.
- **Not waking the agent for a tick at all** (the first decision here). No turn is spent on an approval that needs no answer, but the agent learns of an approval only when the user writes again, perhaps about something else. Telling it costs a turn for each run of ticks, and the skill has the agent end that turn in one line when nothing follows.

## Consequences

An agent without the plugin can no longer feed the page by writing a file: the server would still show the file, but nothing tells such an agent what the user ticked. Numbers that change under a move or a removal also change in what the page keeps by number (open nodes, what was read, the node history). The Claude Code channel, which could wake an idle session, is not used yet. Codex is untested: its MCP configuration is standard, its hooks and plugin layout are unverified.
