import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { checkZeroComments } from "../src/policies/zero-comments.js";

const config = DEFAULT_CONFIG.policies["zero-comments"];

describe("zero-comments across additional languages", () => {
  const cases: { file: string; base: string; current: string; shouldFail: boolean }[] = [
    {
      file: "main.rs",
      base: "fn main() {}\n",
      current: '// entry point\nfn main() { let s = "// not a comment"; }\n',
      shouldFail: true,
    },
    {
      file: "app.rb",
      base: "puts 'hi'\n",
      current: "# greet\nputs 'hi'\nputs '# not a comment'\n",
      shouldFail: true,
    },
    {
      file: "Main.java",
      base: "class Main {}\n",
      current: '// entry\nclass Main { String s = "// not a comment"; }\n',
      shouldFail: true,
    },
    {
      file: "main.c",
      base: "int main() { return 0; }\n",
      current: '/* entry */\nint main() { char *s = "// not a comment"; return 0; }\n',
      shouldFail: true,
    },
    {
      file: "script.sh",
      base: "echo hi\n",
      current: '# greet\necho hi\necho "# not a comment"\n',
      shouldFail: true,
    },
    {
      file: "index.php",
      base: "<?php\necho 'hi';\n",
      current: "<?php\n// greet\necho 'hi';\necho '// not a comment';\n",
      shouldFail: true,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.file}: flags new comments, ignores lookalike strings`, async () => {
      const report = await checkZeroComments(testCase.file, testCase.base, testCase.current, config);
      expect(report.ok).toBe(!testCase.shouldFail);
    });
  }
});
