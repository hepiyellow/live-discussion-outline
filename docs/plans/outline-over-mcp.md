# The server owns the outline; agents change it through MCP

**Status:** built on the `outline-over-mcp` branch as server mode; what was decided while building is in [ADR 0003](../adr/0003-the-server-owns-the-outline.md). The `two-modes` branch keeps file mode beside it for a transition ([plan](two-modes.md)). Not built: the Claude Code channel, and the Codex packaging beyond the MCP process and the hook script. · **Terms:** [CONTEXT.md](../../CONTEXT.md)

## Summary

Today the agent writes the outline as a markdown file and the server watches the folder. In this idea the server owns the outline. The agent and the user are both its clients: the agent sends nodes, claims and the queue; the user sends approvals, picks and runs. Each learns from the server what the other did. No file is part of the contract.

## Why consider it

- **Guarantees.** The server can enforce rules that [skill/SKILL.md](../../skill/SKILL.md) only asks for: unique numbers, one current node, roll-up, queue upkeep.
- **Approvals as state.** A tick on the page is recorded at once. The pending status and the `overrides`, `sent` and `backTo` sections of [state.js](../../state.js) go away, as do the pasted "Approved in the outline" lines.
- **One writer.** Today the agent and `renameOutline` in `server.js` both write the file.

Cloud agents were the strongest reason at first. They are out of scope for now (see the end), which leaves the three reasons above.

## Shape

- **Target:** Claude Code first, compatible with Codex CLI.
- **Packaging:** a plugin per agent over shared parts. Both agents' plugins can bundle skills, MCP servers and hooks, with nearly the same folder layout.
- **MCP tools** carry the agent's changes. The agent no longer writes the file at all.
- **Hooks** carry guarantees: hand the agent what the user did on the page when a prompt is submitted, and put the outline's map back after compaction or resume. Both agents have these events.
- **The skill** keeps only judgment (below).
- **Claude Code extra:** the experimental channel can push a message into an idle session, as [spike/channel/channel.js](../../spike/channel/channel.js) shows. Codex has no counterpart.

## Tools

| Tool | What it does |
|---|---|
| **start** | Opens or reattaches an outline session. Returns the page link. |
| **read** | Returns the whole outline, or one node and its descendants, as compact text. |
| **change** | Takes a list of operations and applies them together. One call per turn. |

There is no write of the whole outline: it would cost 2,500 to 7,000 tokens a turn on current outlines, overwrite what the user did since the agent last looked, and leave the server guessing what changed.

Operations inside `change`:

| Operation | Meaning |
|---|---|
| **add** | A new node under a parent: plain, a claim, a question with its options (one may be recommended), or an action. It may carry children, which covers the first build. |
| **update** | Replace the title, text or closing lines of a node, or switch it between open and claim. |
| **move** | Put a node under another parent. |
| **remove** | Take a node out. |
| **record** | What the user decided in chat: approve, reopen, or pick an option. |
| **finish** | An action was carried out, with its outcome. |
| **message** | A note for the inbox, optionally tied to a node. |
| **queue** | Replace the whole queue: items in priority order, each with a node number, an optional label and a read-only flag. |

- **Operations say what the agent means,** not which field to set, so the tools use the glossary's words.
- **Update replaces a whole field.** Editing part of a text would bring back "text not found" failures.
- **Move and remove exist to prevent append-only outlines.**
- **The agent proposes a node's number** and the server rejects a duplicate, so chat and outline keep the same numbers.

## What the server does on its own

- Rolls statuses up and marks the current node (the last one touched).
- Sets each queue item's kind from its node, updates it when the node changes, and drops items the user handled or whose node is gone.
- Rejects operations that break a rule, with the reason and a hint.

Every result carries back the user's actions since the agent's last call, a map (numbers, titles, statuses) around what was touched, and nodes waiting on the user that are not in the queue.

## What the skill keeps

- **What to mirror:** the substance, not the transcript.
- **Where things go:** node or bullet; an answer changes the node it is about.
- **Honesty:** a claim is only what is settled or certain; an approval is recorded only when the user gave it; the model is never guessed.
- **Chat habits:** the same full-path numbers in chat and outline; no repeating the outline in chat.
- **Actions:** proposed, and run only when asked.

## Keeping the agent's picture of the outline fresh

The agent will not reliably remember the outline, and it will read less than today because an update no longer needs the old text. The design must not depend on it choosing to read:

- **A map in every result.**
- **Cheap reads of one node and its descendants.**
- **A stale-write guard:** an update to a node that changed since the server last showed it to this agent is rejected, and the current text comes back.
- **A reload after compaction or resume,** by hook.

Not covered: the agent forgetting a node's text within one long conversation and rewriting it with a detail missing. Only the skill's guidance addresses that. It is the first thing to test in a trial.

## Compared with today

Measured on 12 outline sessions outside this repo, 113 turns that touched an outline (a rough pattern match; sizes in characters):

| Measure today | Value |
|---|---|
| Tool calls per turn on the outline | median 1, mean 1.8, max 8 |
| Text the agent writes per turn | about 2,000 characters |
| Text it reads back per turn | about 1,500 characters |
| Writes by Edit / by shell script / by Write | 86 / 77 / 8 |
| Writes that failed loudly | 3 of 171 |

- **Efficiency: about even.** Most of what the agent writes is node text, the same either way. Without the batching `change` tool, MCP would be slower, since agents today already batch edits into one script.
- **Correctness: MCP removes silent errors** (a script edit that matches nothing, broken structure, a whole-file rewrite that drops someone else's change). None of these has been observed in use.
- **Judgment errors are unchanged,** and they decide whether an outline is good.
- **New risks:** append-only drift, and more variation between models using unfamiliar tools.

**The cheaper alternative.** With cloud agents out of scope, the agent could keep writing the file while a hook checks it after each write and reports broken structure. That would buy much of the correctness for far less change. It would not make approvals state, and two writers would remain.

## Settled in the discussion

- The transport is MCP, and the agent does not write the file directly.
- Claude Code first, compatible with Codex.
- Cloud agents are out of scope for now.

## Open

- **This idea or the cheaper alternative** (see Compared with today).
- **Storage:** markdown or JSON. The agent never sees it, so it can change later; markdown needs no migration.
- **Approvals and the agent:** whether a pick or approval wakes the agent so it can object. Recording it (state, final) and the agent's opinion of it (a message) are separate.
- **Numbers when a node moves.**
- **Terms:** the **Outline** entry and the pending status would change; **Question** and **Option** have no entries yet (the code says `isQuestion` in [outline.js](../../outline.js)).

## Limits

- The hook files differ per agent.
- The channel is Claude Code only. For Codex the page reaches the agent by typing into its session terminal, as today.

## Out of scope for now: cloud agents

Kept here in case the goal returns:

- The Transcript and Terminal tabs read Claude Code's local transcript and tmux. For a cloud agent the page would show the outline and the inbox only.
- A Claude Code cloud session does not load plugins installed on the user's machine or enabled in the repository's settings, only ones an organization distributes through managed settings ([Install and manage plugins](https://code.claude.com/docs/en/discover-plugins)). A cloud agent would need the MCP server connected some other way.
- The page cannot wake a cloud agent that has no session terminal and no channel.

## Sources for the Codex facts

- [Hooks – Codex, OpenAI docs](https://learn.chatgpt.com/docs/hooks)
- [Plugins – ChatGPT and Codex, OpenAI docs](https://learn.chatgpt.com/docs/plugins)
- The plugin folder layout comes from third-party guides and is unverified.
