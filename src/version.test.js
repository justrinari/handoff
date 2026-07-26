import { describe, it, expect } from "vitest";
import { CLI_NAME } from "./version.js";

describe("cli identity", () => {
  it("names itself handoff", () => {
    expect(CLI_NAME).toBe("handoff");
  });
});
