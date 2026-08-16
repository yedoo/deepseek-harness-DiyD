export interface UpdateChannelState {
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  supported: boolean;
  skipped?: boolean;
}

export interface UpdateStates {
  desktop: UpdateChannelState;
  harness: UpdateChannelState;
}

export type UpdateAction =
  | { kind: "check-desktop"; label: string }
  | { kind: "download-desktop"; label: string }
  | { kind: "install-desktop"; label: string }
  | { kind: "check-harness"; label: string }
  | { kind: "show-harness"; label: string };

export interface UpdateRowPresentation {
  name: string;
  version: string;
  status: string;
  action?: UpdateAction;
}

export interface UpdatePresentation {
  icon: "idle" | "checking" | "available" | "downloading" | "ready";
  desktop: UpdateRowPresentation;
  harness: UpdateRowPresentation;
}

export function presentUpdates(states: UpdateStates): UpdatePresentation {
  return {
    icon: presentIcon(states),
    desktop: presentDesktop(states.desktop),
    harness: presentHarness(states.harness),
  };
}

function presentIcon(states: UpdateStates): UpdatePresentation["icon"] {
  if (states.desktop.phase === "downloaded") {
    return "ready";
  }
  if (states.desktop.phase === "downloading") {
    return "downloading";
  }
  if (
    (states.desktop.phase === "available" && !states.desktop.skipped) ||
    (states.harness.phase === "available" && !states.harness.skipped)
  ) {
    return "available";
  }
  if (states.desktop.phase === "checking" || states.harness.phase === "checking") {
    return "checking";
  }
  return "idle";
}

function presentDesktop(state: UpdateChannelState): UpdateRowPresentation {
  const current = `v${state.currentVersion}`;
  const available = state.version ? `${current} → v${state.version}` : current;
  switch (state.phase) {
    case "checking":
      return { name: "桌面客户端", version: current, status: "正在检查…" };
    case "up-to-date":
      return { name: "桌面客户端", version: current, status: "已是最新" };
    case "available":
      return {
        name: "桌面客户端",
        version: available,
        status: state.skipped ? "已跳过此版本" : "发现新版本",
        action: { kind: "download-desktop", label: "下载更新" },
      };
    case "downloading":
      return {
        name: "桌面客户端",
        version: available,
        status: `正在下载 ${state.percent ?? 0}%`,
      };
    case "downloaded":
      return {
        name: "桌面客户端",
        version: available,
        status: "下载完成",
        action: { kind: "install-desktop", label: "重启更新" },
      };
    case "error":
      return {
        name: "桌面客户端",
        version: current,
        status: "检查失败",
        action: { kind: "check-desktop", label: "重试" },
      };
    default:
      return {
        name: "桌面客户端",
        version: current,
        status: state.supported ? "尚未检查" : "安装版中可用",
      };
  }
}

function presentHarness(state: UpdateChannelState): UpdateRowPresentation {
  const current = compactHarnessVersion(state.currentVersion);
  const available = state.version
    ? `${current} → ${compactHarnessVersion(state.version)}`
    : current;
  switch (state.phase) {
    case "checking":
      return { name: "DeepSeek Harness", version: current, status: "正在检查…" };
    case "up-to-date":
      return { name: "DeepSeek Harness", version: current, status: "已是最新" };
    case "available":
      return {
        name: "DeepSeek Harness",
        version: available,
        status: state.skipped ? "已跳过此版本" : "发现新版本",
        action: { kind: "show-harness", label: "查看更新" },
      };
    case "error":
      return {
        name: "DeepSeek Harness",
        version: current,
        status: "检查失败",
        action: { kind: "check-harness", label: "重试" },
      };
    default:
      return {
        name: "DeepSeek Harness",
        version: current,
        status: state.supported ? "尚未检查" : "未识别运行目录",
        action: state.supported
          ? undefined
          : { kind: "check-harness", label: "重新识别" },
      };
  }
}

function compactHarnessVersion(version: string): string {
  const prerelease = /-(rc\.\d+)$/.exec(version)?.[1];
  return prerelease ?? (version ? `v${version}` : "—");
}
