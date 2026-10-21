import { describe, it, expect } from "vitest";
import { filterFiles, truncate, matchesGlob } from "../src/filter.js";
import type { CommitFile } from "../src/git.js";

describe("matchesGlob", () => {
  it("matches wildcard extensions and paths", () => {
    expect(matchesGlob("src/index.test.ts", "*.test.ts")).toBe(true);
    expect(matchesGlob("src/components/Button.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchesGlob("dist/index.js", "dist/")).toBe(true);
    expect(matchesGlob("src/main.ts", "test/**")).toBe(false);
  });
});

describe("filterFiles", () => {
  it("case 1: removes lockfiles", () => {
    const files: CommitFile[] = [
      { path: "package-lock.json", diff: "+ lockfile content" },
      { path: "pnpm-lock.yaml", diff: "+ yaml content" },
      { path: "yarn.lock", diff: "+ yarn content" },
      { path: "src/app.ts", diff: "+ console.log('ok');" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/app.ts");
  });

  it("case 2: removes minified files and source maps", () => {
    const files: CommitFile[] = [
      { path: "vendor/jquery.min.js", diff: "+ minified js" },
      { path: "styles/theme.min.css", diff: "+ minified css" },
      { path: "dist/bundle.js.map", diff: "+ source map" },
      { path: "src/utils.ts", diff: "+ export const add = (a, b) => a + b;" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/utils.ts");
  });

  it("case 3: removes build output directories (dist, build, .next)", () => {
    const files: CommitFile[] = [
      { path: "dist/index.js", diff: "+ dist file" },
      { path: "build/app.js", diff: "+ build file" },
      { path: ".next/static/chunk.js", diff: "+ next file" },
      { path: "src/index.ts", diff: "+ const app = 1;" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/index.ts");
  });

  it("case 4: removes binary files and images", () => {
    const files: CommitFile[] = [
      { path: "assets/logo.png", diff: "Binary files differ" },
      { path: "assets/banner.jpg", diff: "diff data" },
      { path: "icons/favicon.ico", diff: "diff data" },
      { path: "lib/engine.wasm", diff: "diff data" },
      { path: "src/component.tsx", diff: "+ export const Comp = () => <div/>;" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/component.tsx");
  });

  it("case 5: removes files with binary diff markers in diff text", () => {
    const files: CommitFile[] = [
      { path: "custom.bin", diff: "Binary files a/custom.bin and b/custom.bin differ" },
      { path: "blob.dat", diff: "GIT binary patch\nlzx9..." },
      { path: "src/data.ts", diff: "+ export const data = [1, 2];" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/data.ts");
  });

  it("case 6: removes files matching custom ignore globs", () => {
    const files: CommitFile[] = [
      { path: "src/schema.generated.ts", diff: "+ generated code" },
      { path: "docs/architecture.md", diff: "+ docs" },
      { path: "src/service.ts", diff: "+ class Service {}" },
    ];
    const filtered = filterFiles(files, ["*.generated.ts", "docs/**"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/service.ts");
  });

  it("case 7: removes empty diffs", () => {
    const files: CommitFile[] = [
      { path: "src/empty.ts", diff: "" },
      { path: "src/whitespace.ts", diff: "   \n\r\n  " },
      { path: "src/valid.ts", diff: "+ function test() {}" },
    ];
    const filtered = filterFiles(files);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src/valid.ts");
  });
});

describe("truncate", () => {
  it("case 8: returns truncated: false and preserves diffs when within maxDiffChars", () => {
    const files: CommitFile[] = [
      { path: "src/a.ts", diff: "+ line 1\n+ line 2" },
      { path: "src/b.ts", diff: "+ line 3" },
    ];
    const result = truncate(files, 5000);
    expect(result.truncated).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].diff).toBe("+ line 1\n+ line 2");
  });

  it("case 9: handles huge diff by truncating and setting truncated: true", () => {
    // Generate 500 lines
    const hugeDiff = Array.from({ length: 500 }, (_, i) => `+ let val_${i} = ${i};`).join("\n");
    const files: CommitFile[] = [{ path: "src/huge.ts", diff: hugeDiff }];

    const result = truncate(files, 1000);
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].diff.length).toBeLessThanOrEqual(1050);
  });

  it("case 10: appends [truncated N lines] marker to truncated file", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `+ line number ${i}`).join("\n");
    const files: CommitFile[] = [{ path: "src/big.ts", diff: lines }];

    const result = truncate(files, 300);
    expect(result.truncated).toBe(true);
    expect(result.files[0].diff).toMatch(/\[truncated \d+ lines\]/);
  });

  it("case 11: prioritizes source code over config over documentation", () => {
    const docDiff = Array.from({ length: 100 }, (_, i) => `+ doc paragraph ${i}`).join("\n");
    const configDiff = Array.from({ length: 100 }, (_, i) => `+ "key_${i}": "val_${i}",`).join("\n");
    const sourceDiff = Array.from({ length: 100 }, (_, i) => `+ const func_${i} = () => {};`).join("\n");

    const files: CommitFile[] = [
      { path: "README.md", diff: docDiff },
      { path: "package.json", diff: configDiff },
      { path: "src/core.ts", diff: sourceDiff },
    ];

    // Priority ordering puts src/core.ts first, package.json second, README.md third
    const result = truncate(files, 2000);
    expect(result.truncated).toBe(true);
    expect(result.files[0].path).toBe("src/core.ts");
    expect(result.files[1].path).toBe("package.json");
    expect(result.files[2].path).toBe("README.md");
  });

  it("case 12: handles empty file list", () => {
    const result = truncate([], 1000);
    expect(result.truncated).toBe(false);
    expect(result.files).toEqual([]);
  });
});
