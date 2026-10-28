/* global chrome */
document.documentElement.dataset.surffishPopupLoaded = "true";
document.querySelector("#state").textContent =
  `Popup loaded for ${chrome.runtime.id}`;
