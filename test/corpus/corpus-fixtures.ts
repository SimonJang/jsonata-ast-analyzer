import type { PathResult } from "../../src/index.js";

export interface CorpusFixture {
  category: string;
  name: string;
  expression: string;
  expectedPaths: PathResult[];
}

const path = (
  value: string,
  confidence: PathResult["confidence"] = "static",
): PathResult => ({ path: value, confidence });

const fixtures: CorpusFixture[] = [];

function add(
  category: string,
  name: string,
  expression: string,
  expectedPaths: PathResult[],
): void {
  fixtures.push({ category, name, expression, expectedPaths });
}

for (let i = 0; i < 12; i++) {
  const root = `basic${i}`;
  const field = `field${i}`;
  add("basic paths", `simple path ${i}`, `${root}.${field}`, [
    path(`${root}.${field}`),
  ]);
  add("basic paths", `wildcard path ${i}`, `${root}.*.${field}`, [
    path(`${root}.*.${field}`),
  ]);
  add("basic paths", `descendant path ${i}`, `${root}.**.${field}`, [
    path(`${root}.**.${field}`),
  ]);
  add("basic paths", `parent path ${i}`, `${root}.%.${field}`, [
    path(`${root}.%.${field}`, "partial"),
  ]);
  add("basic paths", `dynamic bracket ${i}`, `${root}[$dynamic${i}].${field}`, [
    path(`${root}.${field}`),
    path(`${root}[*]`, "dynamic"),
  ]);
}

for (let i = 0; i < 19; i++) {
  const root = `stage${i}`;
  add("path stages", `filter predicate ${i}`, `${root}[price${i} > 10].name${i}`, [
    path(`${root}.name${i}`),
    path(`${root}.price${i}`),
  ]);
  add(
    "path stages",
    `chained filters ${i}`,
    `${root}[active${i}][score${i} > 3].name${i}`,
    [path(`${root}.active${i}`), path(`${root}.name${i}`), path(`${root}.score${i}`)],
  );
  add(
    "path stages",
    `order stage ${i}`,
    `${root}^(>date${i}, <priority${i}).name${i}`,
    [path(`${root}.date${i}`), path(`${root}.name${i}`), path(`${root}.priority${i}`)],
  );
  add("path stages", `group stage ${i}`, `${root}{category${i}: total${i}}`, [
    path(root),
    path(`${root}.category${i}`),
    path(`${root}.total${i}`),
  ]);
  add(
    "path stages",
    `context binding ${i}`,
    `${root}@$item${i}[$item${i}.price${i} > 10].name${i}`,
    [path(`${root}.name${i}`), path(`${root}.price${i}`)],
  );
}

for (let i = 0; i < 25; i++) {
  add(
    "variables and functions",
    `simple bind ${i}`,
    `($x${i} := account${i}.name${i}; $x${i})`,
    [path(`account${i}.name${i}`)],
  );
  add(
    "variables and functions",
    `bind with suffix ${i}`,
    `($x${i} := account${i}; $x${i}.name${i})`,
    [path(`account${i}`), path(`account${i}.name${i}`)],
  );
  add(
    "variables and functions",
    `custom function ${i}`,
    `($fn${i} := function($v) { $v.price${i} * $v.qty${i} }; $fn${i}(items${i}))`,
    [path(`items${i}`), path(`items${i}.price${i}`), path(`items${i}.qty${i}`)],
  );
  add(
    "variables and functions",
    `map callback ${i}`,
    `$map(items${i}, function($v) { $v.name${i} })`,
    [path(`items${i}`), path(`items${i}.name${i}`)],
  );
  add(
    "variables and functions",
    `apply filter map ${i}`,
    `items${i} ~> $filter(function($v) { $v.active${i} }) ~> $map(function($v) { $v.name${i} })`,
    [path(`items${i}`), path(`items${i}.active${i}`), path(`items${i}.name${i}`)],
  );
}

for (let i = 0; i < 15; i++) {
  add(
    "partials",
    `substring partial ${i}`,
    `($first${i} := $substring(?, 0, 5); $first${i}(customer${i}.name${i}))`,
    [path(`customer${i}.name${i}`)],
  );
  add(
    "partials",
    `lookup partial ${i}`,
    `($lookup${i} := $lookup(customers${i}, ?); $lookup${i}(customer${i}.id${i}).name${i})`,
    [path(`customer${i}.id${i}`), path(`customers${i}`), path(`customers${i}.name${i}`)],
  );
  add(
    "partials",
    `replace partial ${i}`,
    `($clean${i} := $replace(?, /\\s+/, " "); $clean${i}(notes${i}))`,
    [path(`notes${i}`)],
  );
}

for (let i = 0; i < 15; i++) {
  add(
    "regex",
    `contains regex ${i}`,
    `$contains(Customer${i}.Email${i}, /@example\\.com$/)`,
    [path(`Customer${i}.Email${i}`)],
  );
  add("regex", `match regex ${i}`, `$match(description${i}, /urgent/i)`, [
    path(`description${i}`),
  ]);
  add("regex", `predicate regex ${i}`, `records${i}[name${i} ~> /^A/]`, [
    path(`records${i}`),
    path(`records${i}.name${i}`),
  ]);
}

for (let i = 0; i < 17; i++) {
  add("constructors", `array constructor ${i}`, `[a${i}.b${i}, c${i}.d${i}]`, [
    path(`a${i}.b${i}`),
    path(`c${i}.d${i}`),
  ]);
  add(
    "constructors",
    `object constructor ${i}`,
    `{"name": customer${i}.name${i}, "city": customer${i}.address${i}.city${i}}`,
    [path(`customer${i}.address${i}.city${i}`), path(`customer${i}.name${i}`)],
  );
  add("constructors", `path array step ${i}`, `Email${i}.[address${i}]`, [
    path(`Email${i}`),
    path(`Email${i}.address${i}`),
  ]);
  add(
    "constructors",
    `object projection fallback ${i}`,
    `items${i}[active${i}].{"value": price${i} ?: fallback${i}}`,
    [
      path(`items${i}`),
      path(`items${i}.active${i}`),
      path(`items${i}.fallback${i}`),
      path(`items${i}.price${i}`),
    ],
  );
  add("constructors", `group keep array ${i}`, `Phone${i}{type${i}:number${i}[]}`, [
    path(`Phone${i}`),
    path(`Phone${i}.number${i}`),
    path(`Phone${i}.type${i}`),
  ]);
}

for (let i = 0; i < 15; i++) {
  add(
    "transforms",
    `update transform ${i}`,
    `| account${i} | {"displayName": first${i} & last${i}} |`,
    [path(`account${i}`), path(`account${i}.first${i}`), path(`account${i}.last${i}`)],
  );
  add(
    "transforms",
    `delete transform ${i}`,
    `| account${i} | {"status": "archived"}, [old${i}.password${i}] |`,
    [path(`account${i}`), path(`account${i}.old${i}.password${i}`)],
  );
  add(
    "transforms",
    `piped nested transform ${i}`,
    `payload${i} ~> |Account${i}|{"order": |Order${i}|{"total": Price${i} * Qty${i}}|}|`,
    [
      path(`payload${i}`),
      path(`payload${i}.Account${i}`),
      path(`payload${i}.Account${i}.Order${i}`),
      path(`payload${i}.Account${i}.Order${i}.Price${i}`),
      path(`payload${i}.Account${i}.Order${i}.Qty${i}`),
    ],
  );
}

for (let i = 0; i < 13; i++) {
  add(
    "mixed combinations",
    `filtered map with external variable ${i}`,
    `($threshold${i} := config${i}.min${i}; $map(items${i}[price${i} > $threshold${i}], function($v) { $v.name${i} }))`,
    [path(`config${i}.min${i}`), path(`items${i}`), path(`items${i}.name${i}`), path(`items${i}.price${i}`)],
  );
  add(
    "mixed combinations",
    `join projection ${i}`,
    `library${i}.loans${i}@$l${i}.books${i}@$b${i}[$l${i}.isbn${i}=$b${i}.isbn${i}].{"title":$b${i}.title${i},"customer":$l${i}.customer${i}}`,
    [
      path(`library${i}.loans${i}.books${i}`),
      path(`library${i}.loans${i}.books${i}.isbn${i}`),
      path(`library${i}.loans${i}.books${i}.title${i}`),
      path(`library${i}.loans${i}.customer${i}`),
      path(`library${i}.loans${i}.isbn${i}`),
    ],
  );
  add(
    "mixed combinations",
    `regex conditional ${i}`,
    `$contains(Customer${i}.Email${i}, /@example\\.com$/) ? $substring(Customer${i}.Name${i}, 0, 3) : fallback${i}.name${i}`,
    [
      path(`Customer${i}.Email${i}`),
      path(`Customer${i}.Name${i}`),
      path(`fallback${i}.name${i}`),
    ],
  );
  add(
    "mixed combinations",
    `parent and regex projection ${i}`,
    `orders${i}.items${i}.{"label": name${i} & ":" & %.date${i}, "clean": description${i} ~> /urgent/i}`,
    [
      path(`orders${i}.items${i}`),
      path(`orders${i}.items${i}.%.date${i}`, "partial"),
      path(`orders${i}.items${i}.description${i}`),
      path(`orders${i}.items${i}.name${i}`),
    ],
  );
  add(
    "mixed combinations",
    `function in map with fallback ${i}`,
    `($fn${i} := function($x) { $x.value${i} ?: default${i}.value${i} }; data${i} ~> $map(function($v) { $fn${i}($v) }))`,
    [path(`data${i}`), path(`data${i}.value${i}`), path(`default${i}.value${i}`)],
  );
}

export const corpusFixtures = fixtures;
