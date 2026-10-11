---
name: outline
description: Start and keep a numbered outline of the current conversation, shown as a collapsible, live-updating page the user reads, approves and replies to. User-invoked only.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Outline of this conversation

Mirror this conversation into an outline. The outline server owns the outline: you change it through three tools, `start`, `read` and `change`, and never write a file. The tools are this plugin's `outline` MCP server. The server keeps the numbers unique, rolls statuses up, marks the node last touched as current, keeps the queue's kinds right and refuses a change that breaks a rule, saying why. What it cannot do is decide what belongs in the outline. That is your part, and the rest of this file is about it.

## Workflow

1. **On invocation**, call `start` with the conversation's subject as `title` (the argument, when one was given) and your model and effort as `model` when you know them. Then build the outline from the conversation so far with one `change`, and reply with the page link `start` returned.
   - **When nothing has been discussed and no topic was given**, call `start` without a title. Do not ask which outline to use, and do not make up a subject: reply with the link and ask what the user wants to work on. Once there is a subject, call `start` again with it as `title`.
   - **`start` decides which outline and which project.** Never list, read or write the outlines folder, and never offer other outlines to reattach to unless the user asks for one by name. Say where the outline is filed only as `start` said it.
2. **After each answer that adds or changes something**, make one `change` call that carries all of it, and mention it in one short line. Do not repeat the link unless asked.
3. **Read every result.** It carries what the user did on the page since you were last told (approvals, picks, a press of Run), a map of the outline, and what waits on the user outside the queue. The same news arrives with the user's prompts. It is already recorded: do not record it again.
4. **When a tool says the session has no outline**, call `start` again: it reattaches.

## What to mirror

- **The substance, not the transcript.** A node holds a point of the discussion: the claim, its reasons, the command, the code. Trim filler, and do not paste whole answers.
- **A node is something the user may decide, approve or discuss on its own.** Everything else is a bullet in a node's text. A topic is a top-level node. Titles are 2 to 8 words.
- **An answer changes the node it is about.** When the user asks about, corrects or narrows existing nodes, `update` those nodes: fold the answer into each one's text and keep its number. If the answer is long or has parts, add child nodes under it. Do not add a sibling that restates or summarizes them. Add a node only for content that is new.
- **Update replaces the whole field.** Write the full new text, keeping what the node already says and still holds. When you no longer have a node's text in front of you, `read` it first; after your context was compacted the server makes you.
- **Move and remove.** When a node turns out to belong elsewhere, `move` it; when it is wrong or superseded, `remove` it. An outline that only grows stops being a mirror. When the user removes a node (a line `Removed from the outline: …`, usually followed by why), remove it and use their reason: if it changes other nodes, update them.
- **A summary sums up a long node's own text** in one sentence. It never answers a question, and it says nothing the text above it does not.
- **Never write icons, emoji or tags** into titles or text. Status, options and actions are fields of the operations; the page draws them.

## Honesty

- **A claim is only what is settled or certain**: what the conversation already settled, or a fact, constraint or conclusion you state as yours. Never mark as a claim something that still needs the user's decision.
- **An answer from the user makes the node a claim, not an approval.** Write their answer into the node in your words and set its status to `claim`: they have not read your wording yet, and they approve it on the page.
- **Record an approval only when the user gave it**: `record` with `approve`, `reopen` or `pick` is for what the user said in chat. Your own certainty is a claim. What they tick on the page is recorded without you.
- **New wording needs a new approval.** When you change the text of a node the user approved, the server makes it a claim again. Say so in chat when it matters.
- **Never guess the model.** Pass `model` to `start` only as you know it.

## Questions and recommendations

- **Options are a question's children, and exactly one gets picked.** Whenever you offer a choice, add the question as a node with `options`, one per alternative, and end its text with "Pick one of the options below." Never list options inline in one node. The page letters them (A), (B), … in order; use the same letters and numbers in chat, and say there too that one should be picked.
- **Recommend at most one option**, with `recommended` and the reason in that option's own text. Without grounds to recommend, recommend none.
- **A recommendation that is not a choice** goes in the node's `recommendation` field, and the node is a claim.

## Actions

- **An action proposes something to do in this session** (run tests, change code) rather than something to decide. Add it with `action`: one sentence on what you will do when the user runs it. Options of a "what should we do" question can be actions.
- **Run only when asked.** Carry out an action when the user presses Run on the page (the news says so, or a line `Run in the outline: …` arrives) or asks in chat, and never before. A pick of an option that is an action does not run it.
- **Then `finish` it** with its outcome, or with `failed` and what went wrong. A failed action can be run again.

## The queue and messages

- **The queue is what you advise the user to handle next**, most important first, up to about seven items: open questions, then actions to run, then approvals, then reading. Replace it with a `queue` operation whenever it changes. The server works out each item's kind from its node and drops what the user handled, so you only choose and order. Mark an item `read` when nothing is to be decided or approved.
- **Recommend before you queue a question.** A question without a recommendation tells the user the thinking is theirs. Keep that for what you have no grounds to recommend on, or what only they can answer.
- **A message is for what the outline does not hold**: the outcome of a request made in chat, a status, a warning. One or two sentences, with the node it relates to when there is one. When the outcome belongs in a node, write it there instead.

## Chat habits

- **The same full-path numbers in chat and outline.** Once this skill is invoked, number the points and options of your answers with their full path (`2.1`, `2.2`, never a bare `1`, `2` under a parent), and use exactly those numbers in the outline, so the user can say "2.1" and mean the same thing in both places. When the server renumbers nodes (after a move or a removal), use the new numbers from then on.
- **Do not repeat the outline in chat.** The chat reply can be longer than the outline; the outline holds the merged result.
