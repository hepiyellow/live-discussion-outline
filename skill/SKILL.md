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

Run `node <repo>/bin/ensure.js`. It starts the server in the background if needed and prints three lines: `dir=<outlines folder>`, `url=<base url>` and `resume=<template>` (the template may be empty). Use those values below.

## Where the file lives

`<dir>/<project-slug>/<YYYY-MM-DD>-<topic-slug>.md`

- `<project-slug>`: basename of the current working directory.
- `<topic-slug>`: kebab-case from the argument, or from the conversation's subject if none was given.
- Create the directory if missing. Never write the file inside a repo or beside plan/PRD files.
- If a file for this conversation already exists (you created it earlier in this session), keep using that path. Do not start a second one unless the user asks.

## Format (plain markdown, no HTML tags)

```markdown
# Topic
Resume: <link or command that reopens this chat>

## 🔥 1. Title of numbered point
Condensed content of that point.
- [ ] 1.1 @options **Short title.** The question the user asked, with the options you proposed.
  - [x] 1.1.1 **Short title.** A point the user approved.
- [ ] 1.2 @recommendation **Short title.** An open point where the user said which way they lean.

## ❓ 2. Next point
...
```

- Line 1 is `# <topic>`. Line 2 is `Resume: <link or command>` that reopens this chat later; the page turns it into a copy button.
  - If the `resume=` template from the Start step is not empty, replace `{session}` in it with this conversation's session id (the id your tool uses for the chat, for example the session folder name in your scratch or transcript path) and write the result, exactly once, without code quotes.
  - If the template is empty and you know your own way to reopen a chat (a link or a command), write that.
  - Otherwise omit the line. Never invent an id or a command.
- Each numbered or bulleted point from your answers is a `##` heading that keeps its number (`## ❓ 2. Title`). Deeper levels use `###`.
- Body content under a heading is the substance of that point: claims, reasons, commands, code blocks. Trim filler; do not paste whole answers.
- The user's follow-up questions and your answers nest as `-` bullets under the point they belong to; a bullet with sub-bullets becomes collapsible in the page.
- **Number every heading and every bullet with its full path** in the file: `1`, `1.1`, `1.1.1`, `2`, `2.1`, … Numbers follow the structure and restart under each parent. Never leave a nested bullet unnumbered. The viewer shows only the last segment (and the full path on hover), but the file keeps the full path.
- **Every bullet has a bold title.** Write `- [ ] <number> **Title.** content`: a short bold title (2 to 6 words, ending in a period or colon inside the bold), then the content as normal text. The viewer renders each nesting level as a table with columns number, title, content. Never put the whole bullet in bold, and never leave the title out.
- **Chat answers use the same numbering, always as full paths.** Once this skill is invoked, whenever you answer with points or suggest options, number them with their full path (`1.1`, `1.2`, `2.1`, `2.2`; never a bare `1`, `2`, `3` under a parent), so a reader scrolling back in the chat can tell where a point sits and what its parents are. Use exactly those numbers in the outline so the user can say "2.1" and mean the same thing in both places. New follow-ups continue the sequence under their parent; do not renumber existing items.
- **Clarifications go into the bullet they clarify.** When the user asks about, corrects or narrows existing bullets (for example "what do you mean by 2.1.3?" or "clarify the bullets in 2.1"), edit those bullets in place: fold the answer into the wording of each affected bullet (`2.1.0` … `2.1.6`) and keep its number. Do not append a new bullet that restates or summarizes them (a `2.1.7 Clarification: …` after six bullets it explains). Add a new numbered bullet only for content that is new and does not belong in any existing bullet, such as a new question or a new sub-point. When an answer touches several bullets, update each one. If a bullet becomes much longer, keep its first line as the claim and put the detail in sub-bullets under it. Chat replies can still be longer than the outline; the outline holds the merged result.
- **Headings** start with a status emoji: ❓ open / not yet discussed, 🔥 being discussed now, ✅ resolved.
- **Every bullet starts with a checkbox**, `- [ ]` or `- [x]`:
  - `[ ]` is open. `[x]` means the user approved it, and writing `[x]` is what turns the viewer's outlined pending tick into a filled checkbox. A tick the user makes in the viewer stays outlined until you record it. Tick a box only when the user approved that bullet, in chat or in a pasted line such as `Approved in the outline: 2.1.3 …; 2.1.5 ….` (the viewer writes these when the user ticks boxes). Never tick a box on your own judgment. A pasted `Reopened in the outline: …` line means untick those boxes.
  - `@options` right after the checkbox and number marks an open bullet where you proposed several options and the user has not said which way they lean. The viewer shows a red "Options" tag.
  - `@recommendation` marks an open bullet that has a recommendation (yours, or one the user stated in the chat); put the recommendation in the bullet's content. The viewer shows a blue "Recommendation" tag. If both would apply, use `@recommendation`.
  - Remove the tag when the user approves (`[x]`). A bullet with neither tag is plain open.
  - A bullet being discussed right now may carry 🔥 after the checkbox: `- [ ] 🔥 2.1 …`.
- Do not write raw HTML (`<details>` etc.); the server escapes it.
- When the user says a subject is resolved, switch its heading emoji to ✅ and tick the bullets they approved. Move 🔥 to wherever the discussion currently is. Only one 🔥 at a time.

## Workflow

1. On invocation: run the Start step, build the file from the conversation so far (the most recent multi-point answer plus any follow-ups) and write it.
2. Reply with the clickable link `<url>/<project-slug>/<file-name-without-.md>`.
3. For the rest of the conversation, after each answer that adds or changes topics, update the same file (Edit, not rewrite) and mention it in one short line. No need to repeat the link unless asked.
4. Do not duplicate the file's content in chat.
