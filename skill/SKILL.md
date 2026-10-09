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
- If a file for this conversation already exists (you created it earlier in this session), keep using that path. Do not start a second one unless the user asks. If it lacks any of the header lines below (`Resume:`, `Model:`, `Terminal:`, `Session:`) that you now have a value for, add them under the title.

## Format (plain markdown, no HTML tags; the queue at the end is described below)

```markdown
# Topic
Resume: <link or command that reopens this chat>
Model: <your model name>, <effort>
Terminal: <tmux session>
Session: <session id>

## 1. Title of numbered point
Condensed content of that point.
- [ ] 1.1 **Short title.** A point with nested sub-points.
  - [x] 1.1.1 **Short title.** A point the user approved.
  - [a] 1.1.2 **Short title.** A claim you stated and are certain of.
  - [ ] 1.1.3 @current **Short title.** The nested bullet being discussed now.
- [a] 1.2 **Short title.** The issue. @Recommendation. The way you recommend, and why.
- [ ] 1.3 @options **Short title.** The question to decide. Pick one of the options below.
  - [ ] 1.3.1 **(A) First option.** What it means and what it costs.
  - [ ] 1.3.2 @recommended **(B) Second option.** What it means, and why you recommend it.
  - [ ] 1.3.3 **(C) Third option.** What it means and what it costs.

## 2. Next point
...
```

- Line 1 is `# <topic>`. Line 2 is `Resume: <link or command>` that reopens this chat later; the page turns it into a copy button.
  - If the `resume=` template from the Start step is not empty, replace `{session}` in it with this conversation's session id (the `session=` value from the Start step; if that is empty, the id your tool uses for the chat, for example the session folder name in your scratch or transcript path) and write the result, exactly once, without code quotes.
  - If the template is empty and you know your own way to reopen a chat (a link or a command), write that.
  - Otherwise omit the line. Never invent an id or a command.
- Line 3 is `Model: <model name>, <effort level>` (for example `Model: Claude Sonnet 5.5, medium`); the page shows it top-right beside the copy button. Write the model you are running as and the reasoning effort you know you are using. Omit the effort if you do not know it, and omit the line if you do not know the model. Never guess. Update it if the model or effort changes mid-discussion.
- Line 4 is `Terminal: <tmux session>` with the `terminal=` value from the Start step, written exactly as printed. The page's Terminal tab shows that session's terminal, and the Transcript tab's input box types into it. Omit the line when the value is empty.
- Line 5 is `Session: <session id>` with the `session=` value from the Start step, written exactly as printed. The page's Transcript tab shows that session's messages. Omit the line when the value is empty.
- Each numbered or bulleted point from your answers is a `##` heading that keeps its number (`## 2. Title`). Deeper levels use `###`.
- Body content under a heading is the substance of that point: claims, reasons, commands, code blocks. Trim filler; do not paste whole answers.
- The user's follow-up questions and your answers nest as `-` bullets under the point they belong to; a bullet with sub-bullets becomes collapsible in the page.
- **Number every heading and every bullet with its full path** in the file: `1`, `1.1`, `1.1.1`, `2`, `2.1`, … Numbers follow the structure and restart under each parent. Never leave a nested bullet unnumbered. The viewer shows only the last segment (and the full path on hover), but the file keeps the full path.
- **Every bullet has a bold title.** Write `- [ ] <number> **Title.** content`: a short bold title (2 to 6 words, ending in a period or colon inside the bold), then the content as normal text. The viewer renders each nesting level as a table with columns number, title, content. Never put the whole bullet in bold, and never leave the title out.
- **Chat answers use the same numbering, always as full paths.** Once this skill is invoked, whenever you answer with points or suggest options, number them with their full path (`1.1`, `1.2`, `2.1`, `2.2`; never a bare `1`, `2`, `3` under a parent), so a reader scrolling back in the chat can tell where a point sits and what its parents are. Use exactly those numbers in the outline so the user can say "2.1" and mean the same thing in both places. New follow-ups continue the sequence under their parent; do not renumber existing items.
- **Clarifications go into the bullet they clarify.** When the user asks about, corrects or narrows existing bullets (for example "what do you mean by 2.1.3?" or "clarify the bullets in 2.1"), edit those bullets in place: fold the answer into the wording of each affected bullet (`2.1.0` … `2.1.6`) and keep its number. Do not append a new bullet that restates or summarizes them (a `2.1.7 Clarification: …` after six bullets it explains). Add a new numbered bullet only for content that is new and does not belong in any existing bullet, such as a new question or a new sub-point. When an answer touches several bullets, update each one. If a bullet becomes much longer, keep its first line as the claim and put the detail in sub-bullets under it. Chat replies can still be longer than the outline; the outline holds the merged result.
- **Never write icons or emoji in the file** (no ✅ ❓ 🔥 💡 ◉, no checkbox symbols). All status is plain text: the `[ ]` / `[a]` / `[x]` checkboxes and `@` tags (`@current`, `@resolved`, `@options`, `@recommended`, `@Recommendation.`). The viewer turns them into icons, colors and collapsing. Headings are `## 2. Title` with nothing before the number; a resolved topic heading takes the tag `@resolved` after its number (`## 3. @resolved Title`), and an open or not-yet-discussed heading has no tag.
- **Every bullet starts with a checkbox**, `- [ ]`, `- [a]`, or `- [x]`:
  - `[ ]` is open. `[a]` is agent-approved: write it when you make a claim the conversation already settled, or a claim you are certain of (a fact, a constraint, or a conclusion you are stating as yours). The viewer shows a blue outlined tick. Do not write `[a]` for something that still needs a user decision.
  - `[x]` means the **user** approved it, and writing `[x]` is what turns the viewer's green outlined pending tick into a filled checkbox. A tick the user makes in the viewer (on an open box or on a blue agent tick) stays green-outlined until you record it. Write `[x]` only when the user approved that bullet, in chat or in a pasted line such as `Approved in the outline: 2.1.3 …; 2.1.5 ….` (the viewer writes these when the user ticks boxes). Never write `[x]` on your own judgment; your own certainty is `[a]`. A pasted `Reopened in the outline: …` line means change those boxes back to `[ ]`.
  - **Options are always nested bullets, one option per bullet, and exactly one gets picked.** Whenever you offer the user a choice, never list the options inline in one bullet ("(A) … (B) … (C) …"). Write the question as its own bullet tagged `@options` right after its number, and end its text with "Pick one of the options below." Write each option as a nested bullet under it, with its letter at the start of the bold title: `**(A) …**`, `**(B) …**`. Give every option a `[ ]` checkbox. The viewer shows a "◉ Pick one" tag on the question and draws its options as radio buttons; choosing one clears the others. Use the same letters and numbers in the chat answer, and say there too that only one should be picked.
  - **Mark the option you recommend** with `@recommended` right after its number (`- [ ] 1.3.2 @recommended **(B) …**`), and give the reason in that option's own text. Use at most one `@recommended` per question, and do not add `@Recommendation.` to the question bullet. The viewer shows that option's radio as a blue outlined dot and puts a 💡 Recommended tag on its title. If you have no recommendation yet, leave every option without the tag.
  - **When the user picks an option** (in chat, or in a pasted line such as `Chosen in the outline: 1.3.2 (B) …`), write `[x]` on that option and on the question bullet, and keep `[ ]` on the other options. Keep the other options, `@options`, and `@recommended` in the file so the choice and its alternatives stay visible. If the user picks a different option later, move the `[x]` to it.
  - `@options` on a leaf bullet (a question whose options were not written out as sub-bullets) shows a red "❓ Options" tag. Prefer writing the options out as above.
  - When a bullet has a recommendation that is not a choice between options, the checkbox is `[a]` (a recommendation is your claim) and the recommendation goes at the end of the bullet's text, starting with the `@Recommendation` tag: `- [a] 1.2 **Short title.** What the issue is. @Recommendation. The way you recommend, and why.` The explanation comes first; `@Recommendation.` and its text come after it, among the closing lines described below. Do not put `@recommendation` after the number. The viewer shows the explanation in the content cell and, below it in that same cell, a 💡 Recommendation tag immediately before the recommendation text. An open `[ ]` bullet that still contains `@Recommendation.` is shown with the same blue outlined tick as `[a]`.
  - Remove `@Recommendation.` when the user approves that bullet (`[x]`). You may keep it on `[a]` if the recommendation is still part of the claim.
  - **`@current` marks the latest discussed bullet, and only that one.** After each answer, move the single `@current` tag to the bullet just discussed, right after its number: `- [ ] 2.1.3 @current **Title.** …`. Remove it from wherever it was before, so the file has exactly one. If the latest discussion is a topic heading with no nested bullet, put it after the heading's number: `## 2. @current Title`. Do not tag the ancestors; the viewer marks the whole path to the current bullet with an orange line. Never use 🔥 for this.
  - **Roll up a parent only when every descendant shares the same file mark.** If every descendant bullet is `[x]`, write `[x]` on the parent (and drop `@options` / `@Recommendation.`). If every descendant is `[a]` and none is `[x]` or `[ ]`, write `[a]` on the parent. If every numbered bullet under a topic heading is `[x]`, tag that heading `@resolved`. Repeat until no further parent qualifies. Do not write `[x]` on a parent while any descendant is still `[ ]` or `[a]`. Exception: an `@options` question counts as `[x]` once one of its options is `[x]`; its unpicked options stay `[ ]` and do not block the roll-up. When descendants are mixed, leave the parent's checkbox as it is; the viewer shows the unique set of child icons (open, blue agent tick, green pending human tick, filled human tick) on that parent, each icon once.
- **Long prose ends with a summary.** When a bullet's text, or a topic heading's own text, runs past one or two lines, end it with `@Summary.` and a one-sentence bottom line. If it answers a question, the summary starts with the answer (`Yes`, `No`, or the choice) and gives the reason in one sentence: `@Summary. Yes: retries are safe because every call is idempotent.` The page shows it after a Summary tag. Keep short bullets without one.
- **Closing lines, in this order:** the prose first, then `@Summary.`, then `@Recommendation.`, then `@Action.`, each tag followed by its text; they are the last things in the bullet (or the heading's text). Each shows on its own line under its tag. Use only the ones that apply.
- **Actions: classify what can be done now.** A session can do more than discuss: run tests, change code, run a command. Tag a bullet `@action` (right after its number, with any other tags) when it proposes something to carry out in this session, rather than something to decide or document; write its title as the action (`- [ ] 2.3 @action **Run the test suite.** …`). The page shows a play button on it.
  - When an `@options` question asks what to do and its options are actions, tag each option `@action` too. When the user picks one, put it in the queue as an `@action` item. Picking does not run it.
  - `Run in the outline: 2.3 …` (sent when the user presses play) means: do that action now. Do not carry out an `@action` before the user runs it, unless they ask in chat.
  - An `@action` bullet ends with an `@Action.` line: one sentence on what you will do when the user runs it (`@Action. Adds a retry wrapper to the client and runs its tests.`). The page shows it after a ▶ Action tag.
  - When you have done it, change its `@action` to `@action @ran` (the play button disappears and a "Ran" tag shows), add the outcome to the bullet (a sub-bullet for anything long), and drop it from the queue.
- **Messages: what the outline does not hold.** When your chat reply carries something worth keeping that you do not write into the outline (the outcome of a request the user made in chat, such as a build or test run; a status; a warning), start a paragraph of the reply with `@message`, then the number of the bullet it relates to if there is one, then one or two sentences: `@message 1.4 The dev watcher compiled cleanly (0 errors) and is still running as task bjh2j4h6x.` The page collects these into an inbox, on that bullet and in its left pane. When the outcome belongs in a bullet (an `@action` you ran, an answer to that bullet's question), write it there instead of sending a message. One paragraph per message; never put `@message` in the outline file.
- **End the file with the queue**: what you advise the user to handle next, most important first. It is a last section headed exactly `## @queue` (no number; it is not a discussion topic, so it never gets a number), with one bullet per item:
  ```markdown
  ## @queue
  - 2.1.3 @decide Pick the storage backend.
  - 2.3 @action Run the test suite.
  - 1.2 @approve Retry policy you recommended.
  - 3.1 @read Why the cache is per user.
  ```
  - Each line is `- <number> @<kind> <short label>`: the number of an existing heading or bullet, written as in the file, then the kind, then a few words. Kinds: `@decide` (an open question or an `@options` pick waiting for the user), `@action` (an `@action` bullet waiting for the user to run it), `@approve` (a recommendation or claim of yours, `[a]` or `@Recommendation.`, waiting for the user's approval), `@read` (something the user should read; no action needed).
  - Order by priority: open decisions first, then actions to run, then approvals, then reading. Keep it short (up to about seven items).
  - The page shows the queue in its left pane, not in the outline, and hides an item as soon as the user approves, picks or runs it there. After each answer, rewrite the queue: drop items the user approved, picked, ran or answered, add new ones, and reorder. Leave the section out when there is nothing to queue.
- When the user says a subject is resolved, tag its heading `@resolved` and tick the bullets they approved; apply the roll-up rule above. Then move `@current` to the latest discussed bullet.

## Workflow

1. On invocation: run the Start step, build the file from the conversation so far (the most recent multi-point answer plus any follow-ups) and write it.
2. Reply with the clickable link `<url>/<project-slug>/<file-name-without-.md>`.
3. For the rest of the conversation, after each answer that adds or changes topics, update the same file (Edit, not rewrite) and mention it in one short line. No need to repeat the link unless asked.
4. Do not duplicate the file's content in chat.
