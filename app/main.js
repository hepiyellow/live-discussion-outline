import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog, shell, utilityProcess } from 'electron'
import { loadConfig, writeSettings } from '../config.js'
import { LOG_FILE } from '../log.js'
import { loginShellPath } from './path.js'
import { superviseServer, tailOf } from './supervisor.js'

// The Outline app ("Outline Only" in the Dock): it runs the server while it is open and shows the page in one window. Its logic is in the modules
// beside this one, which load without Electron; this file wires them to Electron.

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url))
const ICON = fileURLToPath(new URL('./icon/icon.png', import.meta.url))

let win
let server

const pageUrl = port => `http://127.0.0.1:${port}/`
/** Whether `url` is on the page the server serves on `port`. */
const onPage = (url, port = server.port()) => url.startsWith(pageUrl(port))

/** The one window, on the page the server serves. Links that leave the page open in the default browser. */
function showWindow(port) {
    if (win) {
        // The server came back: on another port only if its own was taken meanwhile.
        if (!onPage(win.webContents.getURL(), port)) win.loadURL(pageUrl(port))
        return
    }
    win = new BrowserWindow({ width: 1280, height: 860, title: app.name })
    win.on('closed', () => (win = undefined))
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
    win.loadURL(pageUrl(port))
}

function openInBrowser() {
    const url = win?.webContents.getURL()
    shell.openExternal(url && onPage(url) ? url : pageUrl(server.port()))
}

/** The default menus, plus Open in Browser. */
function setMenu() {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            { role: 'appMenu' },
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
    // One window: closing it quits the app, and quitting ends the server.
    app.on('window-all-closed', () => app.quit())
    app.on('will-quit', () => server?.stop())

    // Not awaited at the top level: Electron holds `ready` back until this module has finished loading.
    Promise.all([loginShellPath(), app.whenReady()]).then(([PATH]) => {
        // The built app's bundle carries the icon; run from the repo, the Dock would show Electron's.
        if (!app.isPackaged) app.dock?.setIcon(ICON)
        setMenu()
        server = superviseServer({
            // A utility process, so the server's blocking ps and tmux calls never freeze the window.
            fork: args => utilityProcess.fork(SERVER, args, { env: { ...process.env, PATH }, cwd: path.dirname(SERVER), serviceName: 'Outline server' }),
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
