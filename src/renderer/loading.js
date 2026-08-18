const message = document.getElementById("status-message");
const details = document.getElementById("status-details");
const activity = document.getElementById("activity");
const actions = document.getElementById("error-actions");
const retryButton = document.getElementById("retry-button");
const selectButton = document.getElementById("select-button");
const logsButton = document.getElementById("logs-button");

window.dshDesktop.onStatus((status) => {
  message.textContent = status.message;
  details.textContent = status.details ?? "";
  const failed = status.phase === "error";
  const canSelectHarness = Boolean(status.canSelectHarness);
  activity.hidden = failed;
  actions.hidden = !failed;
  retryButton.hidden = false;
  selectButton.hidden = !canSelectHarness;
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  message.textContent = "正在重新尝试…";
  details.textContent = "";
  activity.hidden = false;
  actions.hidden = true;
  window.dshDesktop.retry();
  retryButton.disabled = false;
});

selectButton.addEventListener("click", async () => {
  selectButton.disabled = true;
  await window.dshDesktop.selectHarness();
  selectButton.disabled = false;
});

logsButton.addEventListener("click", () => window.dshDesktop.openLogs());
