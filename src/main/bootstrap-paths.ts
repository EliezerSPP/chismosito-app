import { app } from 'electron'
import { join } from 'node:path'

/**
 * Keep the same data directory for development and packaged builds. Without
 * this, Electron derives it from the app name and a packaged build would not
 * see the already downloaded models or settings.
 */
app.setPath('userData', join(app.getPath('appData'), 'chismosito'))
