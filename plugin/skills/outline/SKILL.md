---
name: outline
description: Start and keep a numbered outline of the current conversation, shown as a collapsible, live-updating page the user reads, approves and replies to. User-invoked only.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Outline of this conversation

Mirror this conversation into an outline. The outline server owns the outline: you change it through three tools, `start`, `read` and `change`, and never write a file. The tools are this plugin's `outline` MCP server. The server keeps the numbers unique, rolls approvals up, marks the node last touched as current, names what each queue item asks and refuses a change that breaks a rule, saying why.

This file is the mechanics: how an outline works, the same for every user. Break one of its rules and the page tells the user something false, or stops working. How this user wants to work with an outline is a second skill, the workflow skill (see below). Where the two disagree, this one holds.

## The workflow skill

**An outline has one workflow skill, and `start` tells you which.** Load it before your first `change`, and follow it for everything this file leaves open: when to ask for the user and what to put in the queue, whether tasks wait to be run, how much of the work to mirror and how finely.

- **The outline records it**, and the page shows it. An outline nobody named a workflow for has this plugin's `outline-workflow` (`outline-only:outline-workflow`). If you cannot load skills, read `../outline-workflow/SKILL.md` beside this file.
- **A workflow skill the user names replaces it**, whether they name it when they start the outline or later. Call `start` with its name as `workflow`, load that skill, and follow it from then on. Never pass a `workflow` the user did not name.
- **A resumed session keeps its outline's workflow**: load the one `start` names, not the default. After your context was compacted you are told it again; load it again if its text is gone.

## The user reads the outline, not the chat

**The user does not see the transcript.** They read only the outline page, and they answer there (approvals, picks, Run, and what they type on the page). Your tool results are invisible to them, and so is what you write in chat, with one exception: the server puts the final reply of a turn in the page's inbox when that turn changed nothing in the outline.

So every turn takes one of two shapes:

- **A turn that changes the outline** carries the whole answer in its nodes. Put every explanation, finding, question and recommendation there, and end the turn with at most one short line in chat (for example "Outline updated: 2.3, 4"). That line is not shown to the user, so spend no tokens on prose there: no detailed answer, no summary of the change, no recap.
- **A turn that changes nothing in the outline** answers in its final chat reply, which the user reads in the inbox. Use it for what belongs to no node: a question in passing, a status, a quick fact. Write that reply to stand alone, in markdown, and keep it short. Do not also post it as a message: it would show twice.

Choose by where the answer belongs. What the user may decide, approve or come back to is a node. What is said once and done with is a reply. Never split one answer between the two: when the outline changes, the reply is not shown, so anything left only there is lost.

- **Spend the effort on the nodes.** Make each node's text complete and self-sufficient: for what it covers, the user reads nothing else.
- **Local commands reach the inbox without you.** The output of a command Claude Code runs itself, such as `/context` or `/model`, is put there by the server. Do not repeat it.
- **After a change to the outline, keep the chat reply to one short line, or nothing.** The user does not see it, so do not explain, recap or repeat the outline there.
- **Refer to nodes by their full-path numbers** (`2.1`, `2.2`, never a bare `1`, `2` under a parent) in the short line and in node text, so a reference means the same node everywhere. When the server renumbers nodes (after a move or a removal), use the new numbers from then on.

## The tools

1. **On invocation**, call `start` with the conversation's subject as `title` (the argument, when one was given) and your model and effort as `model` when you know them. Then build the outline from the conversation so far with one `change`, and reply with the page link `start` returned.
   - **When nothing has been discussed and no topic was given**, call `start` without a title. Do not ask which outline to use, do not make up a subject, and do not ask what the user wants to work on: reply with one line that says the outline is ready, with the link, and stop. The user writes when they are ready. Once the conversation has a subject, usually after their first message, call `start` again with it as `title`.
   - **A session the page started has its outline already**, empty: `start` attaches to it and says so. Do as it says.
   - **`start` decides which outline and which project.** Never list, read or write the outlines folder, and never offer other outlines to reattach to unless the user asks for one by name. Say where the outline is filed only as `start` said it.
   - **Never guess the model.** Pass `model` to `start` only as you know it.
2. **After each answer that adds or changes something**, make one `change` call that carries all of it, and mention it in one short line. Work you carry out takes two: one before it and one after (see Tasks). Do not repeat the link unless asked.
3. **Read every result.** It carries what the user did on the page since you were last told (approvals, picks, a press of Run) and a map of the outline. The same news arrives with the user's prompts. It is already recorded: do not record it again.
4. **When a tool says the session has no outline**, call `start` again: it reattaches.
5. **A line `Ticked in the outline: …` is the user's ticks on the page**, sent a few seconds after the last one; the news with it says what they ticked. A line `Run in the outline: …` is their press of Run on a task. What you do about either is your workflow's to say.
6. **Acknowledge every tick you were told of**, in the turn you were told. The page shows a tick as pending, its box fading out and in, until you do. Any `change` you make after being told acknowledges it, so the change that mirrors your answer is enough. When nothing in the outline follows from the ticks, send a `change` that holds the `acknowledge` operation alone, and say so in one line. If you end the turn without it, the turn is held open once and you are told which ticks wait.

## Nodes

- **A node is something the user may decide, approve or discuss on its own.** Everything else is a bullet in a node's text. A topic is a top-level node. Titles are 2 to 8 words.
- **Update replaces the whole field.** Write the full new text, keeping what the node already says and still holds. When you no longer have a node's text in front of you, `read` it first; after your context was compacted the server makes you.
- **Move and remove.** A node that belongs elsewhere is moved with `move`; one that is wrong or superseded is taken out with `remove`. When the user removes a node (a line `Removed from the outline: …`, usually followed by why), remove it and use their reason: if it changes other nodes, update them.
- **A summary sums up a long node's own text** in one sentence. It never answers a question, and it says nothing the text above it does not.
- **Never write icons, emoji or tags** into titles or text. Status, options and tasks are fields of the operations; the page draws them.
- **A node has one kind.** It is plain, a claim, a question, an option, or a task, and the page draws that as its kind mark. A node is never a claim and a task at once: the task that follows from a claim is a node of its own beside the claim, not the same node and not under it. The server refuses a change that would make one node both.

## Claims and approvals

- **A claim is only what is settled or certain**: what the conversation already settled, or a fact, constraint or conclusion you state as yours. Never mark as a claim something that still needs the user's decision.
- **Only the user approves.** An approval on the page is theirs alone: it says they concur with a claim, or accept a plain node as it reads. A task takes no approval: the user runs it, and reads what came of it. Your own certainty is a claim.
- **An answer from the user makes the node a claim, not an approval.** Write their answer into the node in your words and set its status to `claim`: they have not read your wording yet, and they approve it on the page.
- **Record an approval only when the user gave it**: `record` with `approve`, `reopen` or `pick` is for what the user said in chat. What they tick on the page is recorded without you.
- **New wording needs a new approval.** When you change the text of a node the user approved, the server takes the approval off, and the page shows it so: there is nothing to tell the user in chat.

## Questions and recommendations

- **Options are a question's children, and exactly one gets picked.** Whenever you offer a choice, add the question as a node with `options`, one per alternative, and end its text with "Pick one of the options below." Never list options inline in one node. The page letters them (A), (B), … in order.
- **Recommend at most one option**, with `recommended` and the reason in that option's own text. Without grounds to recommend, recommend none.
- **A question with a recommended option is your claim**, a fuller one that also shows what you chose not to claim. One without is an unresolved question: it is the one kind of node that says you need the user.
- **A recommendation that is not a choice** goes in the node's `recommendation` field, and the node is a claim. Something you ask and answer yourself, such as a yes or no, is a claim too, not a question.

## Tasks

- **A task is something for you to do in this session** (run tests, change code) rather than something to decide. It is the outline's word, and means a node of the outline: not a subagent you start, and not an item of a to-do list of your own. What the user does on the page (approving, picking, pressing Run, reading) is an action; you never perform one. Add it with `task`: one short sentence on what you will do when it is run. The page shows it beside the button that runs the task, so it names no files and repeats nothing the node's text says: the node's text describes the task, and the details go there. Options of a "what should we do" question can be tasks.
- **What you carry out has a node before you start**, the one it belongs to or a new one, so the outline never lags behind what you are doing.
- **`finish` it when it is done**, with its outcome, or with `failed` and what went wrong. A failed task can be run again. The page then draws it as a task done.
- **Never finish what you did not do**, and never mark as done an answer, an explanation or a decision: those are claims.

## The queue and messages

- **The queue is what you ask the user to handle**, in the order you give it. Replace it with a `queue` operation whenever it changes. A row in the queue is the only thing on the page that calls for the user, so the queue holds only what you put in it: the server lists nothing else as waiting.
- **The server names what each item asks**, from its node: to decide (an unresolved question), to run (a task not done), to approve (a claim, or a question with a recommended option), or to read (anything you mark so, and a task you carried out). It drops what the user handled. Mark an item `read` when nothing is to be decided or approved.
- **A task you carried out can be in the queue**: the item then asks the user to read what came of it. A task that was queued to be run leaves the queue when you finish it; queue it again if its result is to be checked.
- **A message is for what the outline does not hold**: a status, a warning. One or two sentences, with the node it relates to when there is one. Post one with the `message` operation when it has to name a node, or when the turn also changes the outline; otherwise the turn's reply is the message (see above). The outcome of something you did belongs in its node, not in a message.
