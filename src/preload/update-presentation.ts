export interface UpdateChannelState {
  phase:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  operation?: "check" | "download" | "install";
  stage?: "preparing" | "downloading" | "verifying" | "switching" | "restarting";
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
  | { kind: "install-harness"; label: string };

export interface UpdateRowPresentation {
  name: string;
  version: string;
  status: string;
  tone?: "success" | "error";
  busy?: boolean;
  progress?: number;
  details?: string;
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
  if (
    states.desktop.phase === "checking" ||
    states.harness.phase === "checking" ||
    states.harness.phase === "installing"
  ) {
    return "checking";
  }
  return "idle";
}

function presentDesktop(state: UpdateChannelState): UpdateRowPresentation {
  const current = `v${state.currentVersion}`;
  const available = state.version ? `${current} → v${state.version}` : current;
  switch (state.phase) {
    case "checking":
      return { name: "桌面客户端", version: current, status: "正在检查", busy: true };
    case "up-to-date":
      return {
        name: "桌面客户端",
        version: current,
        status: "已是最新",
        tone: "success",
      };
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
        progress: state.percent ?? 0,
      };
    case "downloaded":
      return {
        name: "桌面客户端",
        version: available,
        status: "下载完成，退出时也会安装",
        tone: "success",
        action: { kind: "install-desktop", label: "立即重启" },
      };
    case "error":
      return {
        name: "桌面客户端",
        version: available,
        status: state.operation === "download" ? "下载中断" : "更新服务暂不可用",
        tone: "error",
        details: state.message,
        action: state.operation === "download"
          ? { kind: "download-desktop", label: "继续下载" }
          : { kind: "check-desktop", label: "重新检查" },
      };
    default:
      return {
        name: "桌面客户端",
        version: current,
        status: state.supported ? "等待自动检查" : "安装版中自动更新",
      };
  }
}

function presentHarness(state: UpdateChannelState): UpdateRowPresentation {
  const current = compactHarnessVersion(state.currentVersion);
  const target = compactHarnessVersion(state.version ?? "");
  const available = state.version ? `${current} → ${target}` : current;
  switch (state.phase) {
    case "checking":
      return { name: "DeepSeek Harness", version: current, status: "正在检查", busy: true };
    case "up-to-date":
      return {
        name: "DeepSeek Harness",
        version: current,
        status: "已是最新",
        tone: "success",
      };
    case "available":
      return {
        name: "DeepSeek Harness",
        version: available,
        status: state.skipped ? "已跳过此版本" : "发现新版本",
        action: { kind: "install-harness", label: `更新到 ${target}` },
      };
    case "installing":
      return {
        name: "DeepSeek Harness",
        version: available,
        status: harnessStageLabel(state.stage),
        busy: true,
      };
    case "error":
      return {
        name: "DeepSeek Harness",
        version: available,
        status: state.operation === "install"
          ? "更新失败，原版本仍可使用"
          : "更新服务暂不可用",
        tone: "error",
        details: state.message,
        action: state.operation === "install" && state.version
          ? { kind: "install-harness", label: "重试更新" }
          : { kind: "check-harness", label: "重新检查" },
      };
    default:
      return {
        name: "DeepSeek Harness",
        version: current,
        status: state.supported ? "等待自动检查" : "未识别运行目录",
        action: state.supported
          ? undefined
          : { kind: "check-harness", label: "重新识别" },
      };
  }
}

function harnessStageLabel(stage: UpdateChannelState["stage"]): string {
  switch (stage) {
    case "downloading":
      return "正在下载并安装";
    case "verifying":
      return "正在校验新版本";
    case "switching":
      return "正在安全切换版本";
    case "restarting":
      return "正在重启 Harness";
    default:
      return "正在准备更新";
  }
}

function compactHarnessVersion(version: string): string {
  const prerelease = /-(rc\.\d+)$/.exec(version)?.[1];
  return prerelease ?? (version ? `v${version}` : "—");
}
