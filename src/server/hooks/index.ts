// Nota: il binario hook importa questo modulo ad ogni evento; chokidar è caricato in modo lazy
// da createHookEventsWatcher().start(), quindi l'import resta leggero (solo moduli node:).
export { eventsFilePath, toHookEvent, runHook, type HookPathsOptions } from './events.js';
export { installHooks, uninstallHooks, installHooksIn, uninstallHooksIn, globalSettingsFile, HOOK_EVENTS } from './install.js';
export { createHookEventsWatcher, createAllHookEventsWatcher, MAX_EVENTS } from './watcher.js';
