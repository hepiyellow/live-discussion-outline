// The Outline app's entry point. It is a CommonJS file because Electron runs one before macOS hands over the link
// that started the app, while an ES module (app/main.js) loads a moment later and would miss that link.
const { app } = require('electron')

const early = []
const hold = (event, link) => {
    event.preventDefault()
    early.push(link)
}
app.on('open-url', hold)

/** The links that arrived before main.js listened for them; it listens itself from this call on. */
exports.takeEarlyLinks = () => {
    app.off('open-url', hold)
    return early.splice(0)
}

import('./main.js')
