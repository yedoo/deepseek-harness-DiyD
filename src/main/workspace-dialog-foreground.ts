interface KoffiLibrary {
  func(
    convention: string,
    name: string,
    result: string,
    arguments_: string[],
  ): (...arguments_: unknown[]) => unknown;
}

interface KoffiModule {
  load(path: string): KoffiLibrary;
  pointer(type: unknown): unknown;
  proto(declaration: string): unknown;
  register(callback: (...arguments_: unknown[]) => unknown, type: unknown): bigint;
  unregister(callback: bigint): void;
}

// Koffi publishes a dedicated CommonJS entry, matching this Electron main bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi = require("koffi") as KoffiModule;

const WORKSPACE_DIALOG_TITLE = "Select Workspace Directory";
const ASFW_ANY = 0xffff_ffff;
const SW_RESTORE = 9;
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_SHOWWINDOW = 0x0040;

export interface WorkspaceDialogForegroundWatcherOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Looks for the ownerless picker only during the short period immediately
 * following a click inside the Harness UI. This keeps the workaround scoped
 * to a user action instead of running a permanent foreground-window poll.
 */
export class WorkspaceDialogForegroundWatcher {
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private deadline = 0;
  private timer: NodeJS.Timeout | undefined;
  private checking = false;
  private disposed = false;

  constructor(
    private readonly bringForward: () => Promise<boolean>,
    options: WorkspaceDialogForegroundWatcherOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 80;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  arm(): void {
    if (this.disposed) {
      return;
    }
    this.deadline = Date.now() + this.timeoutMs;
    if (this.timer !== undefined || this.checking) {
      return;
    }
    void this.check();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async check(): Promise<void> {
    if (this.disposed || Date.now() >= this.deadline) {
      return;
    }
    this.checking = true;
    let found = false;
    try {
      found = await this.bringForward();
    } catch {
      // A native lookup failure must never interrupt the Harness UI.
    } finally {
      this.checking = false;
    }
    if (found || this.disposed || Date.now() >= this.deadline) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.check();
    }, this.intervalMs);
  }
}

interface Win32DialogBindings {
  allowSetForegroundWindow(processId: number): number;
  bringWindowToTop(window: unknown): number;
  enumWindows(callback: bigint, parameter: number): number;
  getWindowTextLength(window: unknown): number;
  getWindowText(window: unknown, buffer: Buffer, length: number): number;
  isIconic(window: unknown): number;
  isWindowVisible(window: unknown): number;
  setForegroundWindow(window: unknown): number;
  setWindowPos(
    window: unknown,
    insertAfter: number,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number,
  ): number;
  showWindow(window: unknown, command: number): number;
}

let win32Bindings: Win32DialogBindings | undefined;

function getWin32Bindings(): Win32DialogBindings {
  if (win32Bindings !== undefined) {
    return win32Bindings;
  }
  const user32 = koffi.load("user32.dll");
  win32Bindings = {
    allowSetForegroundWindow: user32.func(
      "__stdcall",
      "AllowSetForegroundWindow",
      "int",
      ["uint32"],
    ) as Win32DialogBindings["allowSetForegroundWindow"],
    bringWindowToTop: user32.func(
      "__stdcall",
      "BringWindowToTop",
      "int",
      ["void *"],
    ) as Win32DialogBindings["bringWindowToTop"],
    enumWindows: user32.func(
      "__stdcall",
      "EnumWindows",
      "int",
      ["void *", "intptr"],
    ) as Win32DialogBindings["enumWindows"],
    getWindowTextLength: user32.func(
      "__stdcall",
      "GetWindowTextLengthW",
      "int",
      ["void *"],
    ) as Win32DialogBindings["getWindowTextLength"],
    getWindowText: user32.func(
      "__stdcall",
      "GetWindowTextW",
      "int",
      ["void *", "void *", "int"],
    ) as Win32DialogBindings["getWindowText"],
    isIconic: user32.func(
      "__stdcall",
      "IsIconic",
      "int",
      ["void *"],
    ) as Win32DialogBindings["isIconic"],
    isWindowVisible: user32.func(
      "__stdcall",
      "IsWindowVisible",
      "int",
      ["void *"],
    ) as Win32DialogBindings["isWindowVisible"],
    setForegroundWindow: user32.func(
      "__stdcall",
      "SetForegroundWindow",
      "int",
      ["void *"],
    ) as Win32DialogBindings["setForegroundWindow"],
    setWindowPos: user32.func(
      "__stdcall",
      "SetWindowPos",
      "int",
      ["void *", "intptr", "int", "int", "int", "int", "uint32"],
    ) as Win32DialogBindings["setWindowPos"],
    showWindow: user32.func(
      "__stdcall",
      "ShowWindow",
      "int",
      ["void *", "int"],
    ) as Win32DialogBindings["showWindow"],
  };
  return win32Bindings;
}

/** Grant the just-started native picker permission to become foreground. */
export function prepareForWorkspaceDialog(): void {
  if (process.platform !== "win32") {
    return;
  }
  try {
    getWin32Bindings().allowSetForegroundWindow(ASFW_ANY);
  } catch {
    // The timed lookup below remains a fallback if this best-effort grant fails.
  }
}

/** Find the official ownerless COM picker and move it above the desktop shell. */
export async function bringWorkspaceDialogToForeground(): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }

  const bindings = getWin32Bindings();
  let pickerWindow: unknown;
  const enumProc = koffi.proto("int __stdcall DshEnumWindowsProc(void *hwnd, intptr lparam)");
  const callback = koffi.register((window: unknown) => {
    if (bindings.isWindowVisible(window) === 0) {
      return 1;
    }
    const titleLength = bindings.getWindowTextLength(window);
    if (titleLength !== WORKSPACE_DIALOG_TITLE.length) {
      return 1;
    }
    const buffer = Buffer.alloc((titleLength + 1) * 2);
    const copied = bindings.getWindowText(window, buffer, titleLength + 1);
    if (copied <= 0) {
      return 1;
    }
    const title = buffer.toString("utf16le", 0, copied * 2);
    if (title !== WORKSPACE_DIALOG_TITLE) {
      return 1;
    }
    pickerWindow = window;
    return 0;
  }, koffi.pointer(enumProc));

  try {
    bindings.enumWindows(callback, 0);
  } finally {
    koffi.unregister(callback);
  }

  if (pickerWindow === undefined) {
    return false;
  }
  if (bindings.isIconic(pickerWindow) !== 0) {
    bindings.showWindow(pickerWindow, SW_RESTORE);
  }
  const positionFlags = SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW;
  bindings.setWindowPos(pickerWindow, HWND_TOPMOST, 0, 0, 0, 0, positionFlags);
  bindings.bringWindowToTop(pickerWindow);
  bindings.setForegroundWindow(pickerWindow);
  bindings.setWindowPos(pickerWindow, HWND_NOTOPMOST, 0, 0, 0, 0, positionFlags);
  return true;
}
