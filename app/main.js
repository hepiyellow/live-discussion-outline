import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, shell, utilityProcess } from 'electron'
import { loadConfig, writeSettings } from '../config.js'
import { LOG_FILE } from '../log.js'
import { runningSessions } from '../start.js'
import { hasSession } from '../terminal.js'
import { takeEarlyLinks } from './entry.cjs'
import { LINK_BASE, pagePathOf } from './links.js'
import { loginShellPath } from './path.js'
import { DEFAULT_DIR, applyMove, isFirstRun, movePlan, moveQuestion, tildePath } from './settings.js'
import { superviseServer, tailOf } from './supervisor.js'

// The Outline app ("Outline Only" in the Dock): it runs the server while it is open and shows the page in one window.
// Its logic is in the modules beside this one, which load without Electron; this file wires them to Electron.

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url))
const ICON = fileURLToPath(new URL('./icon/icon.png', import.meta.url))

let win
let server
// Set when the outlines folder changed: the window then shows the outline list of the new folder.
let showList = false
// The page path of a link that arrived before the window was there: the window opens on it.
let linked

const pageUrl = (port, pagePath = '/') => `http://127.0.0.1:${port}${pagePath}`
/** Whether `url` is on the page the server serves on `port`. */
const onPage = (url, port = server.port()) => url.startsWith(pageUrl(port))

/** The one window, on the page the server serves. Links that leave the page open in the default browser. */
function showWindow(port) {
    if (win) {
        // The server came back: on another port only if its own was taken meanwhile.
        if (showList || !onPage(win.webContents.getURL(), port)) win.loadURL(pageUrl(port))
        showList = false
        return
    }
    // No title bar: the page's top bar is the window's top row, with the window buttons at its left (index.css).
    win = new BrowserWindow({ width: 1280, height: 860, title: app.name, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 15 } })
    win.on('closed', () => (win = undefined))
    // In full screen macOS hides the window buttons: the page is told, so the top bar takes their room back.
    const markFullScreen = () => win?.webContents.executeJavaScript(`document.documentElement.toggleAttribute('data-fullscreen', ${win.isFullScreen()})`).catch(() => {})
    win.on('enter-full-screen', markFullScreen)
    win.on('leave-full-screen', markFullScreen)
    win.webContents.on('dom-ready', markFullScreen)
    const openOutside = url => /^https?:/.test(url) && shell.openExternal(url)
    win.webContents.setWindowOpenHandler(({ url }) => {
        openOutside(url)
        return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
        if (onPage(url)) return
        event.preventDefault()
        openOutside(url)
    })
    win.loadURL(pageUrl(port, linked))
    linked = undefined
}

/** A link to the app was clicked: the window shows that outline. Any other link only brings the window forward. */
function openLink(link) {
    const pagePath = pagePathOf(link)
    if (!win) {
        // The link started the app, or came while the server was starting.
        linked = pagePath ?? linked
        return
    }
    if (pagePath) win.loadURL(pageUrl(server.port(), pagePath))
    if (win.isMinimized()) win.restore()
    win.show()
    app.focus({ steal: true })
}

function openInBrowser() {
    const url = win?.webContents.getURL()
    shell.openExternal(url && onPage(url) ? url : pageUrl(server.port()))
}

/** A folder the user picks, or undefined when they cancel. */
async function pickFolder(defaultPath) {
    const options = { title: 'Outlines Folder', buttonLabel: 'Choose', defaultPath, properties: ['openDirectory', 'createDirectory'] }
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    return canceled ? undefined : filePaths[0]
}

const ask = options => (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))

/** The first run: asks where outlines are kept, before the server starts. False when the user quits instead. */
async function askForFolder() {
    for (;;) {
        const { response } = await ask({
            type: 'question',
            message: 'Where should your outlines be kept?',
            detail: `Agents write one markdown file per outline into this folder, and ${app.name} shows them. You can change it later from the Settings menu.`,
            buttons: [`Use ${DEFAULT_DIR}`, 'Choose Another Folder…', 'Quit'],
            defaultId: 0,
            cancelId: 2,
        })
        if (response === 2) return false
        const dir = response === 0 ? DEFAULT_DIR : await pickFolder(os.homedir())
        if (!dir) continue
        writeSettings({ dir: tildePath(dir) })
        return true
    }
}

/** Settings › Change Outlines Folder…: picks a folder, offers to move the outlines there, and restarts the server on it. */
async function changeFolder() {
    const from = loadConfig().dir
    const to = await pickFolder(from)
    if (!to) return
    // As the server tells it: a session with a process, or one whose tmux session is alive (an idle one shows no process).
    const running = runningSessions()
    const plan = movePlan({ from, to, isRunning: o => running.has(o.session) || (o.terminal !== '' && hasSession(o.terminal)) })
    if (plan.blocked === 'same') return
    let move = false
    if (plan.blocked === 'inside') {
        const { response } = await ask({
            type: 'warning',
            message: 'The new folder is inside the current one, so the outlines cannot be moved into it.',
            detail: `${tildePath(to)} will be the outlines folder, and the outlines stay in ${tildePath(from)}.`,
            buttons: ['Change Without Moving', 'Cancel'],
            cancelId: 1,
        })
        if (response === 1) return
    } else if (plan.moves.length) {
        const { response } = await ask({ type: 'question', ...moveQuestion(plan), buttons: ['Move', 'Don’t Move', 'Cancel'], defaultId: 0, cancelId: 2 })
        if (response === 2) return
        move = response === 0
    }
    // The server is stopped while the files move, then started again on the same port to watch the new folder.
    await server.stop()
    writeSettings({ dir: tildePath(to) })
    const failed = move ? applyMove(plan).failed : []
    showList = true
    server.start()
    if (failed.length)
        ask({
            type: 'warning',
            message: `${failed.length === 1 ? 'One file' : `${failed.length} files`} could not be moved.`,
            detail: `Left in ${tildePath(from)}:\n${failed
                .slice(0, 8)
                .map(f => `• ${f.file}: ${f.error}`)
                .join('\n')}`,
        })
}

/** The default menus, plus Settings › Change Outlines Folder… and Open in Browser. */
function setMenu() {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                role: 'appMenu',
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { label: 'Settings', submenu: [{ label: 'Change Outlines Folder…', click: changeFolder }] },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            {
                role: 'fileMenu',
                submenu: [{ label: 'Open in Browser', accelerator: 'CmdOrCtrl+Shift+O', click: openInBrowser }, { type: 'separator' }, { role: 'close' }],
            },
            { role: 'editMenu' },
            { role: 'viewMenu' },
            { role: 'windowMenu' },
        ]),
    )
}

/** The server died twice in a row: say so, with the end of its log. */
async function serverGaveUp() {
    const { response } = await dialog.showMessageBox({
        type: 'error',
        message: 'The outline server stopped and could not be started again.',
        detail: `The end of ${LOG_FILE}:\n\n${tailOf(LOG_FILE) || '(empty)'}`,
        buttons: ['Quit', 'Start Again'],
        defaultId: 1,
        cancelId: 0,
    })
    if (response === 1) server.start()
    else app.quit()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
    app.on('second-instance', () => {
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.focus()
    })
    app.on('open-url', (event, link) => {
        event.preventDefault()
        openLink(link)
    })
    takeEarlyLinks().forEach(openLink)
    // One window: closing it quits the app, and quitting ends the server.
    app.on('window-all-closed', () => app.quit())
    app.on('will-quit', () => server?.stop())

    // Not awaited at the top level: Electron holds `ready` back until this module has finished loading.
    Promise.all([loginShellPath(), app.whenReady()]).then(async ([PATH]) => {
        // For the server, and for the tmux this process asks about running sessions.
        process.env.PATH = PATH
        // The built app's bundle carries the icon; run from the repo, the Dock would show Electron's.
        if (!app.isPackaged) app.dock?.setIcon(ICON)
        setMenu()
        if (isFirstRun() && !(await askForFolder())) return app.quit()
        // Agents print links that open this app once it says so in the settings file. Run from the repo, the app does
        // not: macOS hands links only to a built app, whose Info.plist names the scheme.
        if (app.isPackaged && loadConfig().linkBase !== LINK_BASE) writeSettings({ linkBase: LINK_BASE })
        server = superviseServer({
            // A utility process, so the server's blocking ps and tmux calls never freeze the window.
            fork: args => utilityProcess.fork(SERVER, args, { env: process.env, cwd: path.dirname(SERVER), serviceName: 'Outline server' }),
            // The port picked on the first launch is kept; without one, the server picks a free one.
            port: loadConfig().appPort,
            onListening(port) {
                if (port !== loadConfig().appPort) writeSettings({ appPort: port })
                showWindow(port)
            },
            onGaveUp: serverGaveUp,
        })
    })
}
