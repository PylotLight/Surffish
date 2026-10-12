browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'surffish-firefox-probe') {
    return Promise.resolve({
      backgroundKind: 'firefox-background-script',
      browserNamespace: typeof browser !== 'undefined',
      storageLocal: typeof browser.storage?.local?.get === 'function',
      storageSession: typeof browser.storage?.session?.get === 'function'
    });
  }
  return undefined;
});
