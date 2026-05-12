import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaces } from "./useWorkspaces";
import type { Workspace } from "../types";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const mkWs = (id: string, label = id): Workspace => ({
  id,
  dir: `/repo/${id}`,
  label,
  addedAt: "2026-05-12T00:00:00Z",
});

describe("useWorkspaces", () => {
  beforeEach(() => {
    // Reset URL to a clean baseline for each test.
    window.history.replaceState(null, "", "/");
  });

  it("fetches and exposes workspaces, defaulting active to the first", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse([mkWs("a"), mkWs("b")]));

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
    expect(result.current.activeId).toBe("a");
    fetchMock.mockRestore();
  });

  it("respects ?ws= in the URL as initial active workspace", async () => {
    window.history.replaceState(null, "", "/?ws=b");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([mkWs("a"), mkWs("b")]),
    );
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
    expect(result.current.activeId).toBe("b");
  });

  it("falls back when persisted active no longer exists", async () => {
    localStorage.setItem("diffmil.activeWorkspace", "gone");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([mkWs("a"), mkWs("b")]),
    );
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.activeId).toBe("a"));
  });

  it("setActiveId updates URL and localStorage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([mkWs("a"), mkWs("b")]),
    );
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
    act(() => result.current.setActiveId("b"));
    await waitFor(() => {
      expect(localStorage.getItem("diffmil.activeWorkspace")).toBe("b");
      expect(window.location.search).toContain("ws=b");
    });
  });

  it("addWorkspace POSTs to /_/api/workspaces and refreshes", async () => {
    let listingCall = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        const method = init?.method ?? "GET";
        if (url === "/_/api/workspaces" && method === "POST") {
          return Promise.resolve(jsonResponse(mkWs("new")));
        }
        if (url === "/_/api/workspaces") {
          listingCall++;
          if (listingCall === 1) return Promise.resolve(jsonResponse([mkWs("a")]));
          return Promise.resolve(jsonResponse([mkWs("a"), mkWs("new")]));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      });

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));
    await act(async () => {
      await result.current.addWorkspace("/repo/new");
    });
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
    fetchMock.mockRestore();
  });
});
