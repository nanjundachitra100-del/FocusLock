const dashboardLink = document.getElementById("dashboard-link");
const backButton = document.getElementById("back-button");
const blockedMessage = document.getElementById("blocked-message");

chrome.runtime.sendMessage({ type: "GET_CONFIG" }).then((config) => {
  if (config?.configured && typeof config.backendUrl === "string") {
    dashboardLink.href = `${config.backendUrl}/`;
  } else {
    dashboardLink.removeAttribute("href");
    dashboardLink.removeAttribute("target");
    blockedMessage.hidden = false;
    blockedMessage.textContent = "Configure FocusLock in the extension popup to open your dashboard.";
  }
}).catch(() => {
  dashboardLink.removeAttribute("href");
  dashboardLink.removeAttribute("target");
  blockedMessage.hidden = false;
  blockedMessage.textContent = "Could not load your dashboard address. Open FocusLock from the extension popup.";
});

backButton.addEventListener("click", () => {
  history.back();
});
