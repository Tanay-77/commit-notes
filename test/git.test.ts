import { describe, it, expect } from "vitest";
import { parseGitDiff, getCommit } from "../src/git.js";

describe("parseGitDiff", () => {
  it("parses normal modified files", () => {
    const raw = `
diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcdef 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
-const old = 1;
+const current = 2;
`;
    const files = parseGitDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/app.ts");
    expect(files[0].diff).toContain("+const current = 2;");
  });

  it("parses new files (root commit or additions)", () => {
    const raw = `
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/README.md
@@ -0,0 +1,5 @@
+# Hello
`;
    const files = parseGitDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("README.md");
  });

  it("parses deleted files", () => {
    const raw = `
diff --git a/legacy.js b/legacy.js
deleted file mode 100644
index abcdef1..0000000
--- a/legacy.js
+++ /dev/null
@@ -1,5 +0,0 @@
-legacy code
`;
    const files = parseGitDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("legacy.js");
  });

  it("parses binary files", () => {
    const raw = `
diff --git a/images/logo.png b/images/logo.png
new file mode 100644
index 0000000..abcdef1
Binary files /dev/null and b/images/logo.png differ
`;
    const files = parseGitDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("images/logo.png");
    expect(files[0].diff).toContain("Binary files");
  });

  it("handles empty patch output", () => {
    expect(parseGitDiff("")).toEqual([]);
    expect(parseGitDiff("   \n\n  ")).toEqual([]);
  });

  it("parses multiple files cleanly", () => {
    const raw = `
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-a
+a2
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-b
+b2
`;
    const files = parseGitDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[1].path).toBe("src/b.ts");
  });
});

describe("getCommit integration on current repository", () => {
  it("retrieves commit data from HEAD", async () => {
    const commit = await getCommit("HEAD");
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.author).toContain("<");
    expect(commit.date).toBeTruthy();
    expect(commit.message).toBeTruthy();
    expect(commit.files.length).toBeGreaterThan(0);
  });

  it("throws clear error when commit not found", async () => {
    await expect(getCommit("0000000000000000000000000000000000000000")).rejects.toThrow(
      "Commit not found"
    );
  });
});
