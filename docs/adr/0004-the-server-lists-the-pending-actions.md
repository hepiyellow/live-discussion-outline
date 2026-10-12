# The server lists the pending actions; the agent only orders them

The action queue used to be the agent's alone: it chose which nodes to put before the user, and the server only named what each item asked. In server mode the server now reads the queue off the nodes, and the agent keeps one thing, the order. We did this because the user asked for a queue that holds exactly what waits for them and nothing else, and an agent that fills the queue itself both forgets actions from earlier turns and queues nodes only to have them read, which is what a change indicator already does.

## Decisions

- **A pending action is a fact about a node.** A question with no recommended option waits to be decided, and a task that is not done waits to be run. A claim waits to be approved only when its agent asked, with `ask` on the node (written `@asks-approval`): nothing requires an approval, and listing every unapproved claim would bury the queue.
- **The `queue` operation orders, and does nothing else.** A node with no pending action is left out, with a note that says why; an action the agent does not list keeps the place it had. There is no read item and no label.
- **An action leaves the queue when the user performs it**, or when the agent changes its node so that it asks nothing more. The agent cannot take an item off the queue any other way.
- **The turn-end hook holds a turn open once over actions that have no place yet.** Every tool result lists the queue and says which actions those are. A turn that ends all the same leaves them last. A turn in which no action is new owes nothing.
- **File mode is left as it was.** Its agent writes the queue in the file, read item included.

## Considered Options

- **Keep the queue the agent's.** Nothing would change, and the queue would go on depending on the agent remembering, each turn, everything still open.
- **No action queue at all, only the indicators of changes to open.** One concept instead of two, but nothing would call the user back to a question they opened and did not answer.
- **List every unapproved claim.** Nothing to mark and nothing missed, at the price of a queue that is mostly approvals nobody needs.
- **Require the full order every turn.** The agent would reconsider priorities also when no node changed; it costs a call in every turn, for an order that is already complete.

## Consequences

An agent can no longer say "look at this" through the queue: what it changed shows as a pending change, and anything more is a message. A session that runs through an upgrade still sends the old shape of the operation; its items are read as an order, and the ones that are not pending actions come back as notes. An outline from before gets its approve items turned into `ask` on their nodes the first time the server reads it, and loses its read items.
