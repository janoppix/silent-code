import { describe, expect, it } from "vitest";
import { extractCoffeeScriptComments } from "../src/parsers/coffeescript.js";

describe("CoffeeScript lexer", () => {
  it("finds a line comment", () => {
    const comments = extractCoffeeScriptComments("# fetch user\nfetchUser()\n");
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("# fetch user");
  });

  it("finds a block comment", () => {
    const comments = extractCoffeeScriptComments("###\nblock comment\n###\nfetchUser()\n");
    expect(comments).toHaveLength(1);
    expect(comments[0].startLine).toBe(1);
    expect(comments[0].endLine).toBe(3);
  });

  it("does not treat a # inside a single-quoted string as a comment", () => {
    const comments = extractCoffeeScriptComments("text = '# not a comment'\n");
    expect(comments).toHaveLength(0);
  });

  it("does not treat a # inside a double-quoted string as a comment", () => {
    const comments = extractCoffeeScriptComments('text = "# not a comment"\n');
    expect(comments).toHaveLength(0);
  });

  it("handles interpolation inside double-quoted strings", () => {
    const comments = extractCoffeeScriptComments('greet = "hello #{name} # not a comment"\n');
    expect(comments).toHaveLength(0);
  });

  it("does not treat a block string as a comment", () => {
    const comments = extractCoffeeScriptComments("text = '''\n# not a comment\n'''\n");
    expect(comments).toHaveLength(0);
  });

  it("treats an extended regex as opaque, not a comment", () => {
    const comments = extractCoffeeScriptComments("re = ///\n  foo # not a comment\n///\n");
    expect(comments).toHaveLength(0);
  });

  it("distinguishes division from a regex literal", () => {
    const comments = extractCoffeeScriptComments("x = a / b / c\n# real comment\n");
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("# real comment");
  });
});
