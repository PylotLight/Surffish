const result = {
  browserNamespace: typeof browser !== 'undefined',
  storageLocal: typeof browser !== 'undefined' && typeof browser.storage?.local?.get === 'function',
  backgroundReply: false,
  backgroundError: null
};

if (result.browserNamespace) {
  browser.runtime.sendMessage({ type: 'sockfish-firefox-probe' }, (response) => {
    result.backgroundReply = Boolean(response);
    result.backgroundError = browser.runtime.lastError?.message || null;
    result.backgroundResponse = response || null;
    document.documentElement.dataset.sockfishFirefoxProbe = JSON.stringify(result);
  });
} else {
  document.documentElement.dataset.sockfishFirefoxProbe = JSON.stringify(result);
}
