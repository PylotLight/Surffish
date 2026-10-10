document.documentElement.dataset.sockfishPopupLoaded = 'true';
document.querySelector('#state').textContent = `Popup loaded for ${chrome.runtime.id}`;
