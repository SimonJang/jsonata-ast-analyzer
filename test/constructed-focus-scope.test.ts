import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
  key: "a",
};
const shape = '{"wrap":{(key):{"copy":record},"other":{"different":other}}}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$v.wrap',
  '($v.wrap)',
  '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))',
  '$map([$v],function($x){$x.wrap})',
];

describe("constructed focus scopes", () => {
  for (const binding of ['.other@$child', '.other@$child[$child.different.details]']) {
    const staticShape = '{"wrap":{"left":{"copy":record},"other":{"different":other}}}';
    const expected = { left: { copy: input.record }, other: { different: input.other } };
    const predicateReads = binding.includes("[") ? [exact("other.details"), exact("other.details.*")] : [];

    it.each(producers)(`returns siblings from terminal focus ${binding} using %s`, async (producer) => {
      const expression = `($v:=${staticShape};(${producer})${binding})`;
      expect(await jsonata(expression).evaluate(input)).toEqual(expected);
      expect(accesses(expression)).toEqual([
        subtree("other"), ...predicateReads, subtree("record"),
      ]);
    });

    it.each(producers)(`stringifies siblings from terminal focus ${binding} using %s`, async (producer) => {
      const expression = `($v:=${staticShape};$string((${producer})${binding}))`;
      expect(await jsonata(expression).evaluate(input)).toBe(JSON.stringify(expected));
      expect(accesses(expression)).toEqual([
        exact("other"), exact("other.**"), ...predicateReads, exact("record"), exact("record.**"),
      ]);
    });

    it.each(producers)(`keeps counted siblings exact from terminal focus ${binding} using %s`, async (producer) => {
      const expression = `($v:=${staticShape};$count((${producer})${binding}))`;
      expect(await jsonata(expression).evaluate(input)).toBe(1);
      expect(accesses(expression)).toEqual([exact("other"), ...predicateReads, exact("record")]);
    });
  }

  for (const binding of ['@$child#$i', '@$child[$child.other.different.details]#$i']) {
    const predicateReads = binding.includes("[") ? [exact("envelope.other.details"), exact("envelope.other.details.*")] : [];
    const nestedInput = { envelope: { ...input, unrelated: { nested: "context" } } };

    it.each(producers)(`returns the input context from terminal first focus ${binding} using %s`, async (producer) => {
      const expression = `envelope.($v:=${shape};(${producer})${binding})`;
      expect(await jsonata(expression).evaluate(nestedInput)).toEqual(nestedInput.envelope);
      expect(accesses(expression)).toEqual([
        subtree("envelope"), exact("envelope.key"), exact("envelope.other"), ...predicateReads, exact("envelope.record"),
      ]);
    });

    it.each(producers)(`stringifies the input context from terminal first focus ${binding} using %s`, async (producer) => {
      const expression = `envelope.($v:=${shape};$string((${producer})${binding}))`;
      expect(await jsonata(expression).evaluate(nestedInput)).toBe(JSON.stringify(nestedInput.envelope));
      expect(accesses(expression)).toEqual([
        exact("envelope"), exact("envelope.**"), exact("envelope.key"), exact("envelope.other"), ...predicateReads, exact("envelope.record"),
      ]);
    });

    it.each(producers)(`counts the input context from terminal first focus ${binding} using %s`, async (producer) => {
      const expression = `envelope.($v:=${shape};$count((${producer})${binding}))`;
      expect(await jsonata(expression).evaluate(nestedInput)).toBe(1);
      expect(accesses(expression)).toEqual([
        exact("envelope"), exact("envelope.key"), exact("envelope.other"), ...predicateReads, exact("envelope.record"),
      ]);
    });
  }

  it.each(producers)("shadows data with a position declared after a wildcard predicate from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).*@$child[$child.copy.details]#$i.$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("shadows data with a position declared after a named predicate from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).other@$child[$child.different.details]#$i.$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"), exact("other.details.*"), exact("record"),
    ]);
  });

  it.each(producers)("shadows data with a position after the first focus predicate from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer})@$child[$child.other.different.details]#$i.$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"), exact("other.details.*"), exact("record"),
    ]);
  });

  it.each(producers)("keeps outer reads before a post-filter position declaration from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).*@$child[$i.details]#$i[$i=0].$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("keeps grouped positions scalar after named focus predicates from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).other@$child[$child.different.details]#$i{"group":{"position":$i,"value":$child.different}})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ group: { position: 0, value: input.other } });
    expect(accesses(expression)).toEqual([
      exact("key"), subtree("other"), exact("other.details"), exact("other.details.*"), exact("record"),
    ]);
  });

  it.each(producers)("returns parent data after a first focus from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer})@$child.other.details)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.other.details);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("other.details"), exact("record"),
    ]);
  });

  for (const binding of [
    '@$child#$i[$child.other.different.details]',
    '@$child[$child.other.different.details]#$i',
  ]) {
    it.each(producers)(`returns parent data after first focus ${binding} from %s`, async (producer) => {
      const expression = `($v:=${shape};(${producer})${binding}.other.details)`;
      expect(await jsonata(expression).evaluate(input)).toEqual(input.other.details);
      expect(accesses(expression)).toEqual([
        exact("key"), exact("other"), subtree("other.details"), exact("other.details.*"), exact("record"),
      ]);
    });

    it.each(producers)(`reads stringified parent data after first focus ${binding} from %s`, async (producer) => {
      const expression = `($v:=${shape};$string((${producer})${binding}.other.details))`;
      expect(await jsonata(expression).evaluate(input)).toBe(JSON.stringify(input.other.details));
      expect(accesses(expression)).toEqual([
        exact("key"), exact("other"), exact("other.details"), exact("other.details.*"), exact("other.details.**"), exact("record"),
      ]);
    });

    it.each(producers)(`keeps counted parent data exact after first focus ${binding} from %s`, async (producer) => {
      const expression = `($v:=${shape};$count((${producer})${binding}.other.details))`;
      expect(await jsonata(expression).evaluate(input)).toBe(1);
      expect(accesses(expression)).toEqual([
        exact("key"), exact("other"), exact("other.details"), exact("other.details.*"), exact("record"),
      ]);
    });
  }

  it.each(producers)("keeps a predicate's focus binding before bare selections from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].other.different.details.amount)`;
    expect(await jsonata(expression).evaluate(input)).toBe(20);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("other.details.amount"),
      exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("keeps named focus predicates before parent selections from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).other@$child[$child.different.details].a.copy)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"), exact("other.details.*"),
      subtree("record"),
    ]);
  });

  it.each(producers)("preserves a later projection's selected focus value from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].other.($child.copy))`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("record"),
      exact("record.details"), exact("record.details.*"),
    ]);
  });


  it.each(producers)("reads terminal wildcard focus predicates consumed by count from %s", async (producer) => {
    const expression = `($v:=${shape};$count((${producer}).*@$child[$child.copy.details]))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"),
      exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("reads terminal named focus predicates consumed by count from %s", async (producer) => {
    const expression = `($v:=${shape};$count((${producer}).other@$child[$child.different.details]))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"), exact("other.details.*"), exact("record"),
    ]);
  });


  it.each(producers)("shadows an outer data alias with a wildcard position from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).*@$child#$i[$i=0].$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([exact("key"), exact("other"), exact("record")]);
  });

  it.each(producers)("shadows an outer data alias with a named position from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).other@$child#$i[$i=0].$i)`;
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([exact("key"), exact("other"), exact("record")]);
  });

  it.each(producers)("keeps positional fields scalar beside selected data from %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};(${producer}).other@$child#$i[$i=0].{"position":$i,"value":$child.different})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ position: 0, value: input.other });
    expect(accesses(expression)).toEqual([exact("key"), subtree("other"), exact("record")]);
  });


  it.each(producers)("reads grouped values through a terminal focus from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details]{"group":$child.copy.details})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ group: input.record.details });
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"), subtree("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("reads a grouped parent value beside a terminal focus from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details]{"group":other.different.details})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ group: input.other.details });
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("other.details"),
      exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("reads a dynamic grouping key through a terminal focus from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details]{($child.copy.name.label):$child.copy.details})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ One: input.record.details });
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"), subtree("record.details"),
      exact("record.details.*"), exact("record.name.label"),
    ]);
  });

  it.each(producers)("reads grouped parent values consumed by count from %s", async (producer) => {
    const expression = `($v:=${shape};$count((${producer}).*@$child[$child.copy.details]{"group":other.different.details}))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"),
      exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("reads dynamic group keys consumed by count from %s", async (producer) => {
    const expression = `($v:=${shape};$count((${producer}).*@$child[$child.copy.details]{($child.copy.name.label):$child.copy.details}))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("record"), exact("record.details"),
      exact("record.details.*"), exact("record.name.label"),
    ]);
  });

});
