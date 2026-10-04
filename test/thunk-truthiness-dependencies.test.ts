import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
};
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const procedures = [
  ["", '$lookup($x,"copy")'],
  ["$l:=$lookup;", '$l($x,"copy")'],
  ['$l:=$lookup(?,"copy");', '$l($x)'],
  ["$l:=function($x){$x.copy};", '$l($x)'],
  ['$box:={"f":$lookup};', '$box.f($x,"copy")'],
];

describe("truthiness of tail-call results", () => {
  it("enumerates an object returned by a callable object value", async () => {
    const source = '$count($sift({"operation":function($x){$x.children.name}},function($operation){$operation(detail)}))';
    expect(await jsonata(source).evaluate({ detail: { children: { name: { label: "One" } } } })).toBe(1);
    expect(accesses(source)).toEqual([
      exact("detail"), exact("detail.children.name"), exact("detail.children.name.*"),
    ]);
  });

  it("preserves physical roots beside constructed aliases returned by a tail call", async () => {
    const source = '$reduce([{"x":detail},fallback],function($acc,$value){$append($acc,$value)},[]).x.children.name';
    const data = {
      detail: { children: { name: { label: "Detail" } } },
      fallback: { x: { children: { name: { label: "Fallback" } } } },
    };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([data.detail.children.name, data.fallback.x.children.name]);
    expect(accesses(source)).toEqual([
      exact("detail"), { ...exact("detail.children.name"), coverage: "subtree" },
      exact("fallback"), { ...exact("fallback.x.children.name"), coverage: "subtree" },
    ]);
  });

  for (const builtin of ["filter", "single", "sift"]) {
    const data = builtin === "filter" ? '[{"copy":record},{"copy":other}]'
      : builtin === "single" ? '[{"copy":record}]'
      : '{"one":{"copy":record},"two":{"different":other}}';
    const reads = builtin === "filter" ? [exact("other"), exact("other.*")]
      : builtin === "sift" ? [exact("other")] : [];

    it.each(procedures)(`enumerates returned input-object keys in ${builtin} (case=%#)`, async (prefix, body) => {
      const source = `(${prefix}$count($${builtin}(${data},function($x){${body}})))`;
      expect(await jsonata(source).evaluate(input)).toBe(builtin === "filter" ? 2 : 1);
      expect(accesses(source)).toEqual([...reads, exact("record"), exact("record.*")]);
    });
  }

  it("keeps scalar tail-call results exact", async () => {
    const source = '$count($filter([record,other],function($x){$length($x.name.label)}))';
    expect(await jsonata(source).evaluate(input)).toBe(2);
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.name.label"), exact("record"), exact("record.name.label"),
    ]);
  });

  it("does not evaluate a returned function value for truthiness", async () => {
    const source = '$count($filter([record,other],function($x){function(){$lookup($x,"copy")}}))';
    expect(await jsonata(source).evaluate(input)).toBe(0);
    expect(accesses(source)).toEqual([exact("other"), exact("record")]);
  });
});
