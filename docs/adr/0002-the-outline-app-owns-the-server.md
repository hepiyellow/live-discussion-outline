# The Outline app owns the server; agents find the outlines folder through one settings file

The agent used to start the server itself: the skill ran `bin/ensure.js`, which started the server in the background when `/health` did not answer and printed the outlines folder and the page's URL. With the Outline app, two things could start the server, and a server started by an agent outlived every window that showed it. We are making the app the only thing that starts the server, stopped when the app quits, and having the agent read one settings file, `~/.config/live-discussion-outline/config.json`, to learn where to write outlines and which link to print. The agent only writes files, so it never needs the server, and it keeps writing outlines while nothing serves them.

## Decisions

- **One settings file at a fixed path.** The skill, the server and the app all read it. No environment variable overrides the outlines folder, the ports, the resume template or the file's path: an app opened from the Finder does not see the shell profile's variables while the agent does, so the two would disagree about where outlines go.
- **One default outlines folder**, `~/live-discussion-outlines`, for the skill, the server and the app alike when the file or its `dir` is missing.
- **Whoever writes the file keeps the keys it does not own.** The app writes `dir`, `appPort` and `linkBase`; the user writes the rest by hand.
- **The link is a setting.** The skill prints `<linkBase>/<project>/<file>`. The app writes a link base in its own URL scheme, so a link opens the app; without the key the link is `http://localhost:<port>`.
- **`npm start` stays** for the setup without the app: the user starts the server, and the skill behaves the same.

## Considered Options

- **Keeping `ensure.js` beside the app.** The page would always be up when an agent prints a link, but the agent and the app would each start a server, on ports that need not match, and nothing would stop the agent's.
- **A login item or a background service.** The server would always run, at the cost of a process the user did not start and cannot see; quitting the app would no longer stop it.
- **Environment variables over the file, as before.** Convenient in a shell, but they are the one setting the app cannot see.
- **The app writing the folder and the link into the skill file.** No settings file to read, but the skill is a symlink into the repo and is shared with setups that have no app.

## Consequences

Once skills in the wild read the settings file, its path and keys are an interface: moving or renaming them breaks agents that were not updated. An agent may print a link to a page nothing is serving; an app link starts the app, and an `http://` link fails until the user runs `npm start`.
