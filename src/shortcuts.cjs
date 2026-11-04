'use strict';
// Handle the accelerator before Electron's default Reload menu command.
function installReturnShortcut(webContents, platform = process.platform) {
  webContents.on('before-input-event', (event, input) => {
    const primary = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    if (input.type !== 'keyDown' || !primary || input.alt || input.shift || String(input.key).toLowerCase() !== 'r') return;
    event.preventDefault();
    if (!input.isAutoRepeat) webContents.send('session:return');
  });
}
module.exports = { installReturnShortcut };
