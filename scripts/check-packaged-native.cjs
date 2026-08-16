const path = require("node:path");
const { app } = require("electron");

const timeout = setTimeout(() => {
  console.error("Packaged native smoke test timed out.");
  app.exit(1);
}, 10_000);

app.whenReady().then(async () => {
  const packagedModule = path.join(
    __dirname,
    "..",
    "release",
    "win-unpacked",
    "resources",
    "app.asar",
    "dist",
    "main",
    "workspace-dialog-foreground.js",
  );
  const { bringWorkspaceDialogToForeground } = require(packagedModule);
  const found = await bringWorkspaceDialogToForeground();
  clearTimeout(timeout);
  console.log(JSON.stringify({ nativeBindingsLoaded: true, dialogFound: found }));
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
