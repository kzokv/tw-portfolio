import { describe, expect, it } from "vitest";
import { parseOAuthState, tamperSignedValue } from "../src/utils/oauth.js";

describe("parseOAuthState", () => {
  it("parses a 2-part state without returnTo or invite code", () => {
    expect(parseOAuthState("nonce.signature")).toEqual({
      segments: ["nonce", "signature"],
      segmentCount: 2,
      unsignedPayload: "nonce",
      nonce: "nonce",
      returnToBase64: undefined,
      inviteCode: undefined,
      signature: "signature",
    });
  });

  it("parses a 3-part state with returnTo", () => {
    expect(parseOAuthState("nonce.cmV0dXJuVG8.signature")).toEqual({
      segments: ["nonce", "cmV0dXJuVG8", "signature"],
      segmentCount: 3,
      unsignedPayload: "nonce.cmV0dXJuVG8",
      nonce: "nonce",
      returnToBase64: "cmV0dXJuVG8",
      inviteCode: undefined,
      signature: "signature",
    });
  });

  it("parses a 4-part state with returnTo and invite code", () => {
    expect(parseOAuthState("nonce.cmV0dXJuVG8.INVITE42.signature")).toEqual({
      segments: ["nonce", "cmV0dXJuVG8", "INVITE42", "signature"],
      segmentCount: 4,
      unsignedPayload: "nonce.cmV0dXJuVG8.INVITE42",
      nonce: "nonce",
      returnToBase64: "cmV0dXJuVG8",
      inviteCode: "INVITE42",
      signature: "signature",
    });
  });
});

describe("tamperSignedValue", () => {
  it("replaces the final signature segment for 3-part state", () => {
    expect(tamperSignedValue("nonce.cmV0dXJuVG8.signature")).toBe(
      "nonce.cmV0dXJuVG8.badhmacsignature",
    );
  });

  it("replaces the final signature segment for 4-part state", () => {
    expect(tamperSignedValue("nonce.cmV0dXJuVG8.INVITE42.signature")).toBe(
      "nonce.cmV0dXJuVG8.INVITE42.badhmacsignature",
    );
  });
});
