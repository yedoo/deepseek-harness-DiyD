export type NavigationDecision = "allow" | "external" | "block";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function classifyNavigation(
  targetUrl: string,
  harnessOrigin: string | undefined,
): NavigationDecision {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return "block";
  }

  if (harnessOrigin && target.origin === harnessOrigin) {
    return "allow";
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return "block";
  }

  if (LOOPBACK_HOSTS.has(target.hostname.toLowerCase())) {
    return "block";
  }

  return "external";
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
