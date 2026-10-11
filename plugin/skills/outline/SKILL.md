---
name: outline
description: Start and keep a numbered outline of the current conversation, shown as a collapsible, live-updating page the user reads, approves and replies to. User-invoked only.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Outline of this conversation

Mirror this conversation into an outline. The outline server owns the outline: you change it through three tools, `start`, `read` and `change`, and never write a file. The tools are this plugin's `outline` MCP server. The server keeps the numbers unique, rolls statuses up, marks the node last touched as current, keeps the queue's kinds right and refuses a change that breaks a rule, saying why. What it cannot do is decide what belongs in the outline. That is your part, and the rest of this file is about it.

## The user reads the outline, not the chat

**The user does not see the transcript at all.** They read only the outline page, and they answer there (approvals, picks, Run, and what they type on the page). Everything you write in chat, and every tool result, is invisible to them.

- **Put every answer, explanation, finding, question and recommendation in the outline.** If it is only in chat, the user never gets it.
- **Spend no tokens on prose in chat.** Do not write the detailed answer, a summary of the change, or a recap of what you found. After your `change` call, end the turn with at most one short line (for example "Outline updated: 2.3, 4"). Nothing in the chat reply is needed for the user to follow.
- **Spend the effort on the nodes instead.** Make each node's text complete and self-sufficient: the user will read nothing else.

## Workflow

1. **On invocation**, call `start` with the conversation's subject as `title` (the argument, when one was given) and your model and effort as `model` when you know them. Then build the outline from the conversation so far with one `change`, and reply with the page link `start` returned.
   - **When nothing has been discussed and no topic was given**, call `start` without a title. Do not ask which outline to use, do not make up a subject, and do not ask what the user wants to work on: reply with one line that says the outline is ready, with the link, and stop. The user writes when they are ready. Once the conversation has a subject, usually after their first message, call `start` again with it as `title`.
   - **A session the page started has its outline already**, empty: `start` attaches to it and says so. Do as it says.
   - **`start` decides which outline and which project.** Never list, read or write the outlines folder, and never offer other outlines to reattach to unless the user asks for one by name. Say where the outline is filed only as `start` said it.
2. **After each answer that adds or changes something**, make one `change` call that carries all of it, and mention it in one short line. The exception is a request to act: its node is added before the work and finished after (see Requests to act), so it takes two calls. Do not repeat the link unless asked.
3. **Read every result.** It carries what the user did on the page since you were last told (approvals, picks, a press of Run), a map of the outline, and what waits on the user outside the queue. The same news arrives with the user's prompts. It is already recorded: do not record it again.
4. **When a tool says the session has no outline**, call `start` again: it reattaches.
5. **A line `Ticked in the outline: …` is the user's ticks on the page**, sent a few seconds after the last one; the news with it says what they ticked. Take the step the ticks open: when they settle what a plan was waiting for, propose its action, or put the action that is already there first in the queue. Do not run it.
6. **Acknowledge every tick you were told of**, in the turn you were told. The page shows a tick as pending, its box fading out and in, until you do. Any `change` you make after being told acknowledges it, so the change that mirrors your answer is enough. When nothing in the outline follows from the ticks, send a `change` that holds the `acknowledge` operation alone, and say so in one line. If you end the turn without it, the turn is held open once and you are told which ticks wait.

## What to mirror

- **The substance, not the transcript.** A node holds a point of the discussion: the claim, its reasons, the command, the code. Trim filler, but the node is all the user reads, so its text must stand alone.
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
- **New wording needs a new approval.** When you change the text of a node the user approved, the server makes it a claim again, and the page shows it as one: there is nothing to tell the user in chat.
- **Never guess the model.** Pass `model` to `start` only as you know it.

## Questions and recommendations

- **Options are a question's children, and exactly one gets picked.** Whenever you offer a choice, add the question as a node with `options`, one per alternative, and end its text with "Pick one of the options below." Never list options inline in one node. The page letters them (A), (B), … in order.
- **Recommend at most one option**, with `recommended` and the reason in that option's own text. Without grounds to recommend, recommend none.
- **A recommendation that is not a choice** goes in the node's `recommendation` field, and the node is a claim.

## Actions

- **An action proposes something to do in this session** (run tests, change code) rather than something to decide. Add it with `action`: one short sentence on what you will do when the user runs it. The page shows it beside the button that runs the action, so it names no files and repeats nothing the node's text says: the node's text describes the action, and the details go there. Options of a "what should we do" question can be actions.
- **Run only when asked.** Carry out an action when the user presses Run on the page (the news says so, or a line `Run in the outline: …` arrives) or asks in chat, and never before. A pick of an option that is an action does not run it.
- **Then `finish` it** with its outcome, or with `failed` and what went wrong. A failed action can be run again.

## Requests to act

- **Classify each prompt first, before you do anything for it.** Two questions, in order:
  1. **Is it a request to act, or not?** A request to act asks you to do something in this session (change code, run a command, fix something). A decision, a question or a request to explain is not one: it is mirrored as the sections above say, and there is nothing to carry out.
  2. **For a request to act: does the outline already have a node for it?** Check the map. If the prompt names a node ("do 2.3"), `read` that node and verify it is really what was asked: a number can be stale or mistyped. A node that does not match is not the node, and the request gets a new one.
- **A request that belongs to an existing node uses that node.** Carry it out, then `finish` the node with its outcome, whether or not it was added as an action.
- **A request with no node gets one before you start.** Make a `change` call that adds the node first, and only then do the work. Pick the node's type from the request: an action (with `action`, one short sentence, the text saying what is asked) when there is something to do; a question with options when something has to be decided first. The user sees the node before the work begins, so the outline never lags behind what you are doing.
- **After the work, `finish` the node** with what happened, or with `failed` and what went wrong. The page draws a yellow tick on a finished action.
- **A request you have not carried out yet**, because something has to be decided first, stays a question or a proposed action, not an action done.
- **Never finish what you did not do**, and never mark as done an answer, an explanation or a decision: those are claims.

## The queue and messages

- **The queue is what you advise the user to handle next**, most important first, up to about seven items: open questions, then actions to run, then approvals, then reading. Replace it with a `queue` operation whenever it changes. The server works out each item's kind from its node and drops what the user handled, so you only choose and order. Mark an item `read` when nothing is to be decided or approved.
- **Recommend before you queue a question.** A question without a recommendation tells the user the thinking is theirs. Keep that for what you have no grounds to recommend on, or what only they can answer.
- **A message is for what the outline does not hold**: a status, a warning. One or two sentences, with the node it relates to when there is one. The outcome of something you did belongs in its node (see Requests to act), not in a message.

## Chat habits

- **Keep the chat reply to one short line, or nothing.** The user does not read it, so do not explain, recap or repeat the outline there. The outline holds the whole answer.
- **Refer to nodes by their full-path numbers** (`2.1`, `2.2`, never a bare `1`, `2` under a parent) in the short line and in node text, so a reference means the same node everywhere. When the server renumbers nodes (after a move or a removal), use the new numbers from then on.
