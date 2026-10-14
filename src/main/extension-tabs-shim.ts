/**
 * chrome.tabs for an extension's own pages (toolbar popup, options/setup tab), shared by the Web Store
 * extension shim and Bramble's alias script. Electron gives extension pages only part of chrome.tabs
 * (no tabs.create or tabs.remove, and a tabs.query that does not see Surffish's tabs or their URLs),
 * so these calls go to Surffish's own tab model over the `surffishExtensionHost.tabs(op, payload)`
 * preload bridge. The main process checks the sender (see extension-tabs-host.ts).
 *
 * The source is a function expression: call it as `(${EXTENSION_PAGE_TABS_SHIM})(chrome, host)`.
 * Keep it free of backticks and template placeholders, since it is spliced into other template strings.
 */
export const EXTENSION_PAGE_TABS_SHIM = `function installSurffishExtensionTabs(api, host) {
  if (!api || !api.runtime || !host || typeof host.tabs !== 'function') return false;
  const define = (target, key, value) => {
    try { Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value }); return true; } catch { return false; }
  };
  const lastFunction = (args) => { const last = args[args.length - 1]; return typeof last === 'function' ? last : undefined; };
  const settle = (promise, callback) => {
    if (!callback) return promise;
    promise.then((value) => callback(value), (error) => {
      try { console.warn('[surffish] extension API call failed:', error && error.message ? error.message : error); } catch {}
      callback(undefined);
    });
    return undefined;
  };
  const tabs = api.tabs || {};
  if (!api.tabs && !define(api, 'tabs', tabs)) return false;
  const run = (op, payload, callback) => settle(Promise.resolve(host.tabs(op, payload)), callback);
  const resolveUrl = (url) => typeof url === 'string' ? new URL(url, api.runtime.getURL('/')).href : undefined;
  const props = (value) => {
    const input = value && typeof value === 'object' ? value : {};
    return { url: resolveUrl(input.url), active: typeof input.active === 'boolean' ? input.active : (typeof input.selected === 'boolean' ? input.selected : undefined), pinned: typeof input.pinned === 'boolean' ? input.pinned : undefined };
  };
  define(tabs, 'TAB_ID_NONE', -1);
  define(tabs, 'query', (queryInfo, callback) => run('query', queryInfo && typeof queryInfo === 'object' ? JSON.parse(JSON.stringify(queryInfo)) : {}, callback));
  define(tabs, 'get', (tabId, callback) => run('get', { tabId }, callback));
  define(tabs, 'getCurrent', (callback) => run('getCurrent', {}, callback));
  define(tabs, 'create', (createProperties, callback) => run('create', props(createProperties), callback));
  define(tabs, 'update', (...args) => {
    const callback = lastFunction(args);
    const tabId = typeof args[0] === 'number' ? args[0] : undefined;
    const updateProperties = typeof args[0] === 'number' ? args[1] : args[0];
    return run('update', { tabId, ...props(updateProperties) }, callback);
  });
  define(tabs, 'reload', (...args) => {
    const callback = lastFunction(args);
    const tabId = typeof args[0] === 'number' ? args[0] : undefined;
    const options = args.find((entry) => entry && typeof entry === 'object');
    return run('reload', { tabId, bypassCache: !!(options && options.bypassCache) }, callback);
  });
  define(tabs, 'remove', (tabIds, callback) => run('remove', { tabIds: Array.isArray(tabIds) ? tabIds : [tabIds] }, callback));
  return true;
}`
