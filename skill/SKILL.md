---
name: live-discussion-outline
description: Start and maintain a numbered markdown outline of the current conversation, served as collapsible live-reloading HTML by the local live-discussion-outline server. User-invoked only.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Live discussion outline

Mirror this conversation into a markdown file. The local server in this checkout renders it as collapsible HTML and reloads the page on every edit. You only write markdown.

## Start

This file is `skill/SKILL.md` in the live-discussion-outline checkout. If you reached it through a symlink, resolve the symlink. The checkout is the parent of that `skill` directory; call it `<repo>`.

Run `node <repo>/bin/ensure.js`. It starts the server in the background if needed and prints five lines: `dir=<outlines folder>`, `url=<base url>`, `resume=<template>` (may be empty), `terminal=<tmux session>` (empty unless you run inside tmux), `session=<session id>` (empty unless your tool provides one) and `project=<name>` (usually empty). Use those values below.

## Where the file lives

`<dir>/<project-slug>/<YYYY-MM-DD>-<topic-slug>.md`

- `<project-slug>`: the `project=` value from the Start step when it is not empty, otherwise the basename of the current working directory.
- `<topic-slug>`: kebab-case from the argument, or from the conversation's subject if none was given.
- Create the directory if missing. Never write the file inside a repo or beside plan/PRD files.
- If a file for this conversation already exists (you created it earlier in this session), keep using that path. Do not start a second one unless the user asks. If it lacks any of the header lines below (`Title:`, `Resume:`, `Model:`, `Terminal:`, `Session:`) that you now have a value for, add them in their place at the top.

## Format (plain markdown, no HTML tags; the queue at the end is described below)

```markdown
Title: Topic
Resume: <link or command that reopens this chat>
Model: <your model name>, <effort>
Terminal: <tmux session>
Session: <session id>

# 1. Title of a topic

The topic's own text.

## 1.1 A node with child nodes

Its text. Plain bullets are fine here:
- one point
- another point

### 1.1.1 @user-approved A node the user approved

### 1.1.2 @agent-claim A claim you stated and are certain of

### 1.1.3 @current The node being discussed now

## 1.2 @agent-claim An issue with a recommendation

What the issue is.

@Recommendation. The way you recommend, and why.

## 1.3 @options The question to decide

What is being decided. Pick one of the options below.

### 1.3.1 @option_A First option

What it means and what it costs.

### 1.3.2 @recommended @option_B Second option

What it means, and why you recommend it.

# 2. Next topic
...
```

**Header lines.** The file starts with these lines, in this order, with no heading before them:
- `Title: <topic>` names the discussion (the page shows it as the title). The user can rename the discussion with the pencil beside it, which rewrites this line; whatever it says now is the name, so keep it as it is when you edit the file.
- `Resume: <link or command>` reopens this chat later; the page turns it into a copy button.
  - If the `resume=` template from the Start step is not empty, replace `{session}` in it with this conversation's session id (the `session=` value from the Start step; if that is empty, the id your tool uses for the chat, for example the session folder name in your scratch or transcript path) and write the result, exactly once, without code quotes.
  - If the template is empty and you know your own way to reopen a chat (a link or a command), write that.
  - Otherwise omit the line. Never invent an id or a command.
- `Model: <model name>, <effort level>` (for example `Model: Claude Sonnet 5.5, medium`); the page shows it top-right beside the copy button. Write the model you are running as and the reasoning effort you know you are using. Omit the effort if you do not know it, and omit the line if you do not know the model. Never guess. Update it if the model or effort changes mid-discussion.
- `Terminal: <tmux session>` with the `terminal=` value from the Start step, written exactly as printed. The page's Terminal tab shows that session's terminal, and the Transcript tab's input box types into it. Omit the line when the value is empty.
- `Session: <session id>` with the `session=` value from the Start step, written exactly as printed. The page's Transcript tab shows that session's messages. Omit the line when the value is empty.

**Nodes are headings.**
- Every point of the discussion is a **node**: a numbered heading plus its text (everything under it, up to the next heading). A **topic** is a top-level node, `# 2. Title` (the number is followed by a period). Nodes under it go one level deeper per step: `## 2.1 Title`, `### 2.1.1 Title`, down to `###### 2.1.1.1.1.1`. Six levels is the hard limit; below that, use plain bullets in the node's text.
- **Number every node with its full path**: `1`, `1.1`, `1.1.1`, `2`, `2.1`, … Numbers follow the structure and restart under each parent. The viewer shows only the last segment (and the full path on hover), but the file keeps the full path.
- **Every number is used once in the file.** The viewer knows a node by its number: two nodes numbered `2.1` are approved together, and the user's approval reaches you with the wrong title. Before you add a topic or a node, read the file as it is now (the user or another session may have changed it) and take the next free number under that parent. Never reuse the number of a node that is still in the file, and never append a second copy of a topic or of the queue: rewrite the one that is there.
- **The heading line is the number, then tags, then a short title** (2 to 8 words, no period at the end): `## 2.1 @agent-claim @options Storage backend`. Never put tags anywhere else on the heading line, and never put them in the text below it.
- **A node's text is ordinary markdown**: paragraphs, plain `-` bullets, numbered lists, code blocks, tables. Use bullets whenever you list or enumerate things inside a node. A bullet has no number and no status; it is not a node. Make something a child node instead when the user may need to decide, approve or discuss it on its own.
- Body text is the substance of the point: claims, reasons, commands, code blocks. Trim filler; do not paste whole answers.
- The user's follow-up questions and your answers become child nodes of the node they belong to.
- **Chat answers use the same numbering, always as full paths.** Once this skill is invoked, whenever you answer with points or suggest options, number them with their full path (`1.1`, `1.2`, `2.1`, `2.2`; never a bare `1`, `2`, `3` under a parent), so a reader scrolling back in the chat can tell where a point sits and what its parents are. Use exactly those numbers in the outline so the user can say "2.1" and mean the same thing in both places. New follow-ups continue the sequence under their parent; do not renumber existing nodes.
- **Answers and clarifications change the node they are about.** When the user asks about, corrects or narrows existing nodes (for example "what do you mean by 2.1.3?" or "clarify the nodes in 2.1"), edit those nodes in place: fold the answer into the text of each affected node and keep its number. If the answer is long or has parts, add child nodes under that node that explain it. Do not append a sibling that restates or summarizes them (a `2.1.7 Clarification` after six nodes it explains), and never answer a question in a summary. Add a new node only for content that is new and does not belong in any existing node, such as a new question or a new sub-point. When an answer touches several nodes, update each one. The chat reply can still be longer than the outline; the outline holds the merged result.
- **Never write icons or emoji in the file** (no ✅ ❓ 🔥 💡 ◉, no checkbox symbols, no `[ ]` / `[x]`). All status is plain `@` tags on the heading line. The viewer turns them into icons, colors and collapsing.

**Status tags.** A node's status is one tag right after its number, or none:
- No tag: **open**.
- `@agent-claim`: your claim, which the tag says is yours and not the user's: a claim the conversation already settled, or one you are certain of (a fact, a constraint, or a conclusion you are stating as yours). The viewer shows a blue outlined tick. Do not write `@agent-claim` on something that still needs a user decision.
- **An answer from the user makes the node a claim.** When the user answers an open question in chat in their own words (rather than approving a node or picking an option), write the answer into that node in your words and tag the node `@agent-claim`. What the node now says is your wording of their answer: the blue tick shows it is settled, and they can approve it to confirm that you understood them. Never leave an answered node untagged, since it then reads as still open, and do not tag it `@user-approved`, since they have not read your wording yet. Take it out of the queue: it asks nothing more of them. If their answer leaves something open, that goes in its own node.
- `@user-approved`: the **user** approved it. The tag says who: it is never yours to give. (Outlines written before this name say `@approved`, which the viewer reads the same way; when you edit such a file, rewrite the tag as `@user-approved`.) The viewer fills the tick. A tick the user makes in the viewer stays green-outlined until you record it. Write `@user-approved` only when the user approved that node, in chat or in a pasted line such as `Approved in the outline: 2.1.3 …; 2.1.5 ….` (the viewer writes these when the user ticks boxes). Never write `@user-approved` on your own judgment; your own certainty is `@agent-claim`. A pasted `Reopened in the outline: …` line means remove `@user-approved` from those nodes. A pasted `Back to claim in the outline: …` line (the user undid an approval of your claims) means replace `@user-approved` with `@agent-claim` on those nodes. An approved topic starts collapsed.
- **Options are always child nodes, one option per node, and exactly one gets picked.** Whenever you offer the user a choice, never list the options inline in one node ("(A) … (B) … (C) …"). Write the question as its own node tagged `@options`, and end its text with "Pick one of the options below." Write each option as a child node tagged with its letter, `@option_A`, `@option_B`, and so on, in order: `### 1.3.1 @option_A Title`. The letter goes in the tag and never in the title; the viewer puts `(A)` before the title itself. Every child of an `@options` question carries such a tag, and no other node does. The viewer shows a "◉ Pick one" tag on the question and draws its options as radio buttons; choosing one clears the others. Use the same letters and numbers in the chat answer, and say there too that only one should be picked.
- **Mark the option you recommend** with `@recommended` (`### 1.3.2 @recommended @option_B Title`), and give the reason in that option's own text. Use at most one `@recommended` per question, and do not add `@Recommendation.` to the question node. The viewer shows that option's radio as a blue outlined dot and puts a 💡 Recommended tag on its title. If you have no recommendation yet, leave every option without the tag.
- **When the user picks an option** (in chat, or in a pasted line such as `Chosen in the outline: 1.3.2 (B) …`), tag that option and the question node `@user-approved`, and leave the other options untagged. Keep the other options, `@options`, and `@recommended` in the file so the choice and its alternatives stay visible: `@user-approved` goes next to `@options` on the question (`## 1.3 @user-approved @options Title`), never in its place. If the user picks a different option later, move the `@user-approved` to it.
- `@options` on a node without child options shows a red "❓ Options" tag. Prefer writing the options out as above.
- When a node has a recommendation that is not a choice between options, tag it `@agent-claim` (a recommendation is your claim) and end its text with a closing line starting `@Recommendation.`: the explanation first, then `@Recommendation. The way you recommend, and why.` An untagged node whose text contains `@Recommendation.` is shown with the same blue outlined tick as `@agent-claim`. Remove `@Recommendation.` when the user approves the node; you may keep it on `@agent-claim` if the recommendation is still part of the claim.
- **`@current` marks the latest discussed node, and only that one.** After each answer, move the single `@current` tag to the node just discussed (`### 2.1.3 @current Title`, after any status tag). Remove it from wherever it was before, so the file has exactly one. Do not tag the ancestors; the viewer marks the whole path to the current node with an orange line.
- **Roll up a parent only when every descendant shares the same status.** If every descendant is `@user-approved`, tag the parent `@user-approved` (and drop `@Recommendation.`). If every descendant is `@agent-claim` and none is open or approved, tag the parent `@agent-claim`. This applies to topics too. Repeat until no further parent qualifies. Do not tag a parent `@user-approved` while any descendant is still open or `@agent-claim`. Exception: an `@options` question counts as approved once one of its options is `@user-approved`; its unpicked options stay untagged and do not block the roll-up. When descendants are mixed, leave the parent's tag as it is; the viewer shows the unique set of child icons on that parent, each icon once.

**Closing lines.**
- **`@Summary.` sums up the node's own text.** When a node's text runs past a few lines, end it with a paragraph `@Summary. <one sentence>` that says what the text above it says, in brief. It is not an answer: never start it with `Yes` or `No`, and never put in it anything the text above does not already say. Keep short nodes without one.
- **Each closing line is its own paragraph, in this order:** `@Summary.`, then `@Recommendation.`, then `@Action.`, each tag followed by its text. They are the last things in the node's text. Use only the ones that apply.

**Actions: classify what can be done now.** A session can do more than discuss: run tests, change code, run a command.
- Tag a node `@action` (on the heading line, with any other tags) when it proposes something to carry out in this session, rather than something to decide or document; write its title as the action (`## 2.3 @action Run the test suite`). The page shows a play button on it.
- When an `@options` question asks what to do and its options are actions, tag each option `@action` too. When the user picks one, put it in the queue as an `@action` item. Picking does not run it.
- `Run in the outline: 2.3 …` (sent when the user presses play) means: do that action now. Do not carry out an `@action` before the user runs it, unless they ask in chat.
- An `@action` node ends with an `@Action.` line: one sentence on what you will do when the user runs it (`@Action. Adds a retry wrapper to the client and runs its tests.`). The page shows it after a ▶ Action tag.
- When you have done it, change its `@action` to `@action-done` (the play button disappears, the node's Action tag turns into a yellow Done tag, and its checkbox shows a filled yellow tick), add the outcome to the node's text (a child node for anything long), and drop it from the queue.
- When you tried and it did not work, change its `@action` to `@action-failed` (its Action tag turns into a red Failed tag, and the play button stays, so the user can run it again), and say in the node's text what went wrong. Keep it in the queue as an `@action` item when running it again makes sense, and add a node for what has to be decided or fixed first when it does not. A `Run in the outline: …` for a failed action means: try again; write `@action-done` or `@action-failed` when you have.
- `@action-done` and `@action-failed` each stand in place of `@action`: write one of the three, never two.

**Messages: what the outline does not hold.** When your chat reply carries something worth keeping that you do not write into the outline (the outcome of a request the user made in chat, such as a build or test run; a status; a warning), start a paragraph of the reply with `@message`, then the number of the node it relates to if there is one, then one or two sentences: `@message 1.4 The dev watcher compiled cleanly (0 errors) and is still running as task bjh2j4h6x.` The page collects these into an inbox, on that node and in its left pane. When the outcome belongs in a node (an `@action` you ran, an answer to that node's question), write it there instead of sending a message. One paragraph per message; never put `@message` in the outline file.

**End the file with the queue**: what you advise the user to handle next, most important first. It is a last section headed exactly `# @queue` (no number; it is not a topic), with one bullet per item:
```markdown
# @queue
- 2.1.3 @decide Pick the storage backend.
- 2.3 @action Run the test suite.
- 1.2 @approve Retry policy you recommended.
- 3.1 @read Why the cache is per user.
```
- Each line is `- <number> @<kind> <short label>`: the number of an existing node, written as in the file, then the kind, then a few words. Kinds: `@decide` (a question you have not answered and have no recommendation for: an open question, or an `@options` question none of whose options is `@recommended`), `@action` (an `@action` node waiting for the user to run it), `@approve` (something of yours waiting for the user's approval: a `@agent-claim`, a `@Recommendation.`, or an `@options` question with a `@recommended` option, which the user approves by picking), `@read` (something the user should read; no action needed).
- **`@decide` is only for what you could not answer.** The viewer shows it with a red question mark, which tells the user that nothing is proposed yet and the thinking is theirs. If the node has a recommendation of yours in any form (`@recommended` on an option, `@Recommendation.`, `@agent-claim`), it is an `@approve` item, never `@decide`. Before you write a `@decide` item, check its node: when you can recommend, recommend there and queue it as `@approve`; keep `@decide` for a question you have no grounds to recommend on, or one only the user can answer (a preference, a fact only they know).
- Order by priority: open decisions (`@decide`) first, then actions to run, then approvals, then reading. Keep it short (up to about seven items).
- The file has one queue section, and it is the last thing in the file.
- The page shows the queue in its left pane, not in the outline, and hides an item as soon as the user approves, picks or runs it there. After each answer, rewrite the queue: drop items the user approved, picked, ran or answered, add new ones, and reorder. Leave the section out when there is nothing to queue.

When the user says a subject is resolved, tag the nodes they approved `@user-approved` and apply the roll-up rule above. Then move `@current` to the latest discussed node.

**Older outlines.** A file in the old format (a `# Title` first line, `##` topics, and `- [ ] 1.1 **Title.**` checkbox bullets) must be converted before you edit it: `Title:` line, topics as `#`, every checkbox bullet as a heading one level per number segment, `[x]` as `@user-approved`, `[a]` as `@agent-claim`, `@resolved` as `@user-approved`, closing lines as their own paragraphs, `## @queue` as `# @queue`.

**Older tag names.** The viewer still reads `@approved`, `@claim` and `@action @ran`, the names before `@user-approved`, `@agent-claim` and `@action-done`, and options whose letter is typed into the title (`### 1.3.1 (A) Title`) instead of tagged (`### 1.3.1 @option_A Title`). Whenever you edit a file that has them, rewrite them to the new names.

## Workflow

1. On invocation: run the Start step, build the file from the conversation so far (the most recent multi-point answer plus any follow-ups) and write it.
2. Reply with the clickable link `<url>/<project-slug>/<file-name-without-.md>`.
3. For the rest of the conversation, after each answer that adds or changes topics, update the same file (Edit, not rewrite) and mention it in one short line. No need to repeat the link unless asked.
4. Do not duplicate the file's content in chat.
