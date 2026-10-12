---
name: outline-workflow
description: The default workflow for an outline kept with the outline skill of this plugin - when to ask for the user, what to put in the queue, when tasks run, how the work is mirrored. Load it only when the outline skill tells you to.
---

# The default outline workflow

This is how to work with a user through an outline when they have not said otherwise. The outline skill holds the mechanics, which are the same for everyone; this file holds the choices, and the user may replace it with a workflow skill of their own. Where this file and the outline skill disagree, the outline skill holds.

## What to mirror

- **The substance, not the transcript.** A node holds a point of the discussion: the claim, its reasons, the command, the code. Trim filler, but the node is all the user reads, so its text must stand alone.
- **An answer changes the node it is about.** When the user asks about, corrects or narrows existing nodes, `update` those nodes: fold the answer into each one's text and keep its number. If the answer is long or has parts, add child nodes under it. Do not add a sibling that restates or summarizes them. Add a node only for content that is new.
- **Keep the outline a mirror.** When a node turns out to belong elsewhere, move it; when it is wrong or superseded, remove it. An outline that only grows stops being a mirror.

## Tasks wait for the user

- **Run only when asked.** Carry out a task when the user presses Run on the page (the news says so, or a line `Run in the outline: …` arrives) or asks in chat, and never before. A pick of an option that is a task does not run it.
- **When the user's ticks arrive, take the step they open.** When they settle what a plan was waiting for, propose its task, or put the task that is already there first in the queue. Do not run it.

## Requests to act

- **Classify each prompt first, before you do anything for it.** Two questions, in order:
  1. **Is it a request to act, or not?** A request to act asks you to do something in this session (change code, run a command, fix something). A decision, a question or a request to explain is not one: it is mirrored, and there is nothing to carry out.
  2. **For a request to act: does the outline already have a node for it?** Check the map. If the prompt names a node ("do 2.3"), `read` that node and verify it is really what was asked: a number can be stale or mistyped. A node that does not match is not the node, and the request gets a new one.
- **A request that belongs to an existing node uses that node.** Carry it out, then `finish` the node with its outcome, whether or not it was added as a task.
- **A request with no node gets one before you start.** Make a `change` call that adds the node first, and only then do the work. Pick the node's type from the request: a task (with `task`, one short sentence, the text saying what is asked) when there is something to do; a question with options when something has to be decided first. The user sees the node before the work begins.
- **After the work, `finish` the node** with what happened, or with `failed` and what went wrong.
- **A request you have not carried out yet**, because something has to be decided first, stays a question or a proposed task, not a task done.

## What to ask the user

- **The queue is what you advise the user to handle next**, most important first, up to about seven items: unresolved questions, then tasks to run, then approvals, then reading.
- **Recommend before you queue a question.** A question without a recommendation tells the user the thinking is theirs. Keep that for what you have no grounds to recommend on, or what only they can answer.
- **Queue a result only when it needs the user's eyes.** A task you carried out and checked yourself asks nothing of them: leave it out of the queue. Queue it, to be read, when its result is something only they can judge or see, or when you could not check it.
