import { describe, expect, it } from "vitest";
import { classifyNavigation } from "../src/main/navigation";

describe("classifyNavigation", () => {
  it("keeps navigation inside the exact local Harness origin", () => {
    expect(
      classifyNavigation(
        "http://127.0.0.1:43121/session/abc",
        "http://127.0.0.1:43121",
      ),
    ).toBe("allow");
  });

  it("opens normal web links outside the desktop window", () => {
    expect(
      classifyNavigation("https://github.com/deepseek-ai", "http://127.0.0.1:43121"),
    ).toBe("external");
  });

  it("blocks unsafe protocols and different local ports", () => {
    expect(classifyNavigation("javascript:alert(1)", "http://127.0.0.1:43121")).toBe(
      "block",
    );
    expect(classifyNavigation("http://127.0.0.1:9000", "http://127.0.0.1:43121")).toBe(
      "block",
    );
  });
});
