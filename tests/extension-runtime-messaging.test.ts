import { describe, expect, it, vi } from "vitest";
import {
  isValidConfigResponse,
  sendRuntimeMessage,
} from "../chrome-extension/runtime-messaging.js";

describe("extension runtime message helper", () => {
  it("rejects missing or malformed config responses", () => {
    expect(isValidConfigResponse(undefined)).toBe(false);
    expect(isValidConfigResponse(null)).toBe(false);
    expect(isValidConfigResponse({ reason: "INVALID_CONFIG" })).toBe(false);
    expect(isValidConfigResponse({ ok: false, reason: "INVALID_CONFIG" })).toBe(true);
  });

  it("resolves the asynchronous service-worker response", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message, callback) => callback({ ok: true })),
    };

    await expect(sendRuntimeMessage(runtime, { type: "SET_CONFIG" })).resolves.toEqual({
      ok: true,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SET_CONFIG" },
      expect.any(Function),
    );
  });

  it("rejects Chrome messaging errors without exposing runtime error details", async () => {
    const runtime = {
      lastError: { message: "Could not establish connection to extension service worker." },
      sendMessage: vi.fn((_message, callback) => callback(undefined)),
    };

    await expect(sendRuntimeMessage(runtime, { type: "SET_CONFIG" })).rejects.toThrow(
      "Extension service-worker messaging failed.",
    );
  });

  it("rejects synchronous messaging failures", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn(() => {
        throw new Error("runtime unavailable");
      }),
    };

    await expect(sendRuntimeMessage(runtime, { type: "SET_CONFIG" })).rejects.toThrow(
      "Extension service-worker messaging failed.",
    );
  });
});
