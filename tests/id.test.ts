import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionId } from "../src/id";

afterEach(() => vi.unstubAllGlobals());

describe("session IDs across secure and insecure pages", () => {
  it("uses the native UUID generator when available", () => {
    const randomUUID = vi.fn(() => "e452ff16-8756-42c6-9599-514246494684");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    expect(createSessionId()).toBe("e452ff16-8756-42c6-9599-514246494684");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("builds a version 4 UUID with the correct variant without randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal("crypto", { getRandomValues });
    expect(createSessionId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("keeps repeated fallback IDs distinct using the cryptographic random source", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(
      globalThis.crypto,
    );
    vi.stubGlobal("crypto", { getRandomValues });
    const ids = Array.from({ length: 1000 }, () => createSessionId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
  });

  it.each([undefined, {}, { randomUUID: undefined }])(
    "explains when no secure random generator is available (%j)",
    (crypto) => {
      vi.stubGlobal("crypto", crypto);
      expect(createSessionId).toThrow("セッションIDを生成できません");
    },
  );
});
