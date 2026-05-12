import { describe, it, expect } from "vitest";
import { isAutoFoldPath } from "./autoFold";

describe("isAutoFoldPath", () => {
  it("returns false for plain source files", () => {
    expect(isAutoFoldPath("src/foo.ts")).toBe(false);
    expect(isAutoFoldPath("internal/server/server.go")).toBe(false);
  });

  it("matches lockfiles by basename", () => {
    expect(isAutoFoldPath("package-lock.json")).toBe(true);
    expect(isAutoFoldPath("a/b/pnpm-lock.yaml")).toBe(true);
    expect(isAutoFoldPath("go.sum")).toBe(true);
    expect(isAutoFoldPath("Cargo.lock")).toBe(true);
  });

  it("matches Unity shader graphs", () => {
    expect(isAutoFoldPath("Assets/Shaders/Foo.shadergraph")).toBe(true);
    expect(isAutoFoldPath("Assets/Subgraph.shadersubgraph")).toBe(true);
  });

  it("matches generated suffix patterns", () => {
    expect(isAutoFoldPath("pkg/api.pb.go")).toBe(true);
    expect(isAutoFoldPath("lib/foo.generated.ts")).toBe(true);
    expect(isAutoFoldPath("models/foo.g.dart")).toBe(true);
  });

  it("matches well-known directories", () => {
    expect(isAutoFoldPath("node_modules/lodash/index.js")).toBe(false); // need leading slash
    expect(isAutoFoldPath("a/node_modules/lodash/index.js")).toBe(true);
    expect(isAutoFoldPath("server/gen/api.go")).toBe(true);
    expect(isAutoFoldPath("dist/main.js")).toBe(false); // also need a slash-bounded match
    expect(isAutoFoldPath("foo/dist/main.js")).toBe(true);
  });

  it("ignores empty input", () => {
    expect(isAutoFoldPath("")).toBe(false);
  });
});
