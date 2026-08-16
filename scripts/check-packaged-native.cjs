const path = require("node:path");
const { existsSync } = require("node:fs");
const { execFile } = require("node:child_process");
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
  const packagedWorker = path.join(
    __dirname,
    "..",
    "release",
    "win-unpacked",
    "resources",
    "app.asar",
    "dist",
    "main",
    "harness-package-worker.js",
  );
  const packagedExecutable = path.join(
    __dirname,
    "..",
    "release",
    "win-unpacked",
    "DeepSeek Harness Desktop.exe",
  );
  const arboristVersion = await new Promise((resolve, reject) => {
    execFile(
      packagedExecutable,
      [packagedWorker, "--probe"],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
        timeout: 10_000,
      },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    );
  });
  const found = await bringWorkspaceDialogToForeground();
  clearTimeout(timeout);
  const result = {
    nativeBindingsLoaded: true,
    dialogFound: found,
    packagedInstallerFound: existsSync(packagedWorker),
    packagedArboristVersion: arboristVersion,
  };
  console.log(JSON.stringify(result));
  if (!result.packagedInstallerFound || result.packagedArboristVersion !== "9.9.1") {
    app.exit(1);
    return;
  }
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
