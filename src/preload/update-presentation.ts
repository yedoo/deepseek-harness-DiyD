export interface UpdateChannelState {
  phase:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "ready-to-restart"
    | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  message?: string;
  operation?: "check" | "download" | "install";
  stage?: "preparing" | "reusing" | "downloading" | "verifying";
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
  | { kind: "install-harness"; label: string }
  | { kind: "restart-harness"; label: string };

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
  if (
    states.desktop.phase === "downloaded" ||
    states.harness.phase === "ready-to-restart"
  ) {
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
        status: desktopProgressLabel(state),
        progress: state.percent ?? 0,
      };
    case "downloaded":
      return {
        name: "桌面客户端",
        version: available,
        status: state.totalBytes === undefined
          ? "下载完成，退出时也会安装"
          : `下载完成 · ${formatBytes(state.totalBytes)}，退出时自动安装`,
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

function desktopProgressLabel(state: UpdateChannelState): string {
  const percent = `${state.percent ?? 0}%`;
  if (state.transferredBytes === undefined || state.totalBytes === undefined) {
    return `正在下载 ${percent}`;
  }
  const speed = state.bytesPerSecond === undefined
    ? ""
    : ` · ${formatBytes(state.bytesPerSecond)}/s`;
  return `${percent} · ${formatBytes(state.transferredBytes)} / ${formatBytes(state.totalBytes)}${speed}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1_024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index];
  }
  return `${value.toFixed(1)} ${unit}`;
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
    case "ready-to-restart":
      return {
        name: "DeepSeek Harness",
        version: available,
        status: "已准备好，重启后生效",
        tone: "success",
        action: { kind: "restart-harness", label: "立即重启" },
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
    case "reusing":
      return "正在复用现有依赖";
    case "downloading":
      return "正在增量下载并安装";
    case "verifying":
      return "正在校验新版本";
    default:
      return "正在准备更新";
  }
}

function compactHarnessVersion(version: string): string {
  const prerelease = /-(rc\.\d+)$/.exec(version)?.[1];
  return prerelease ?? (version ? `v${version}` : "—");
}
