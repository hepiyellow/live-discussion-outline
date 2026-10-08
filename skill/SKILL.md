---
name: live-discussion-outline
description: Start and maintain a numbered markdown outline of the current conversation, served as collapsible live-reloading HTML by the local live-discussion-outline server. User-invoked only.
disable-model-invocation: true
argument-hint: "[topic]"
---

# Live discussion outline

Mirror this conversation into a markdown file. A local server (`__REPO_DIR__`) renders it as collapsible HTML and reloads the page on every edit. You only write markdown.

## Start

Run `node __REPO_DIR__/bin/ensure.js`. It starts the server in the background if needed and prints three lines: `dir=<outlines folder>`, `url=<base url>` and `resume=<template>` (the template may be empty). Use those values below.

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
- ❓ 1.1 A question the user asked
  - 1.1.1 the answer, one line
- ✅ 1.2 A resolved sub-point

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
- **Number every heading and every bullet with its full path**: `1`, `1.1`, `1.1.1`, `2`, `2.1`, … Numbers follow the structure and restart under each parent. Never leave a nested bullet unnumbered.
- **Chat answers use the same numbering.** Once this skill is invoked, whenever you answer with points or suggest options, number them with their full path (`1.1`, `1.2`, `2.1`, `2.2`), and use exactly those numbers in the outline so the user can say "2.1" and mean the same thing in both places. New follow-ups continue the sequence under their parent; do not renumber existing items.
- Status emoji comes first in every heading and question bullet: ❓ open / not yet discussed, 🔥 being discussed now, ✅ resolved.
- Do not write raw HTML (`<details>` etc.); the server escapes it.
- When the user says a subject is resolved, switch its emoji to ✅. Move 🔥 to wherever the discussion currently is. Only one 🔥 at a time.

## Workflow

1. On invocation: run the Start step, build the file from the conversation so far (the most recent multi-point answer plus any follow-ups) and write it.
2. Reply with the clickable link `<url>/<project-slug>/<file-name-without-.md>`.
3. For the rest of the conversation, after each answer that adds or changes topics, update the same file (Edit, not rewrite) and mention it in one short line. No need to repeat the link unless asked.
4. Do not duplicate the file's content in chat.
