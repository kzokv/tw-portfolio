import { describe, expect, it } from "vitest";
import { ASSIGNABLE_SHARE_CAPABILITIES, deriveSharedContextPermissions } from "../../../features/sharing/capabilities";

describe("sharing capabilities", () => {
  it("includes dividend write in assignable delegated capabilities", () => {
    expect(ASSIGNABLE_SHARE_CAPABILITIES).toContain("dividend:write");
  });

  it("derives dividend write permissions from shared capabilities", () => {
    const permissions = deriveSharedContextPermissions(["dividend:write" as never]);

    expect(permissions.canWriteDividends).toBe(true);
    expect(permissions.hasAnyDelegatedWrite).toBe(true);
  });
});
