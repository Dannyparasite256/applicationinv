/**
 * Preload bridge — keep the renderer isolated; expose a tiny desktop flag.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('eimsDesktop', {
  platform: process.platform,
  isDesktop: true,
});
