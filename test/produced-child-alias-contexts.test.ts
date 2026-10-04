import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
  ignored: { nested: { value: 30 } },
  key: "a",
};
const shape = '{"wrap":{(key):{"copy":record},"other":{"different":other}},"unused":ignored}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))',
  '($l:=$lookup;$l($v,$string("wrap")))',
  '($r:=$reverse;$r([$v]).wrap)',
  '($maker:=function(){$v.wrap};$maker())',
  '($l:=$lookup(?,"wrap");$l($v))',
  '$eval("wrap",$v)',
  '$spread($v).wrap',
  '$merge([$v]).wrap',
  '$reverse([$v]).wrap',
  '$append([$v],[]).wrap',
  '$filter([$v],function(){true}).wrap',
  '$map([$v],function($x){$x.wrap})',
  '$reduce([$v],function($acc,$x){$x.wrap},0)',
  '$zip([$v],[0])[0][0].wrap',
];

describe("produced constructed child contexts", () => {
  it.each(producers)("retains computed and static child origins after %s", async (producer) => {
    const expression = `($v:=${shape};$count((${producer}).**))`;
    expect(await jsonata(expression).evaluate(input)).toBe(13);
    expect(accesses(expression)).toEqual([
      exact("ignored"),
      ...(producer.includes('$string("wrap")') ? [exact("ignored.**")] : []),
      exact("key"), exact("other"), exact("other.**"),
      exact("record"), exact("record.**"),
    ]);
  });

  it.each(producers)("selects a static sibling field after %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).other.different.details.amount)`;
    expect(await jsonata(expression).evaluate(input)).toBe(20);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"), exact("other"),
      { path: "other.details.amount", confidence: "static", coverage: "subtree" },
      exact("record"),
    ]);
  });

  it.each(producers)("preserves whole selected values after sorting %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*^(copy.details.amount))`;
    expect(await jsonata(expression).evaluate(input)).toEqual([
      { copy: input.record }, { different: input.other },
    ]);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"),
      { path: "other", confidence: "static", coverage: "subtree" },
      { path: "record", confidence: "static", coverage: "subtree" },
      exact("record.details.amount"),
    ]);
  });

  it.each(producers)("groups against the selected constructed child from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).other{"group":different.details})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ group: input.other.details });
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"), exact("other"),
      { path: "other.details", confidence: "static", coverage: "subtree" },
      exact("record"),
    ]);
  });

  it.each(producers)("retains wildcard focus metadata from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].$child.copy)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"), exact("other"),
      { path: "record", confidence: "static", coverage: "subtree" },
      exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("retains named focus metadata from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).other@$child[$child.different.details].$child.different)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.other);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"),
      { path: "other", confidence: "static", coverage: "subtree" },
      exact("other.details"), exact("other.details.*"), exact("record"),
    ]);
  });


  it.each(producers)("retains focused predicate reads before block projections from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].($child.copy))`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"), exact("other"),
      { path: "record", confidence: "static", coverage: "subtree" },
      exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("retains focused predicate reads before builtin calls from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].$count($child.copy))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([
      exact("ignored"), exact("key"), exact("other"), exact("record"),
      exact("record.details"), exact("record.details.*"),
    ]);
  });

});
