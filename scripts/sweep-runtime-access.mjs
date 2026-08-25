import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import jsonata from "jsonata";
import { extractPaths } from "../dist/index.js";

if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/sweep-runtime-access.mjs <jsonata-test-suite-root>",
  );
}

const suiteRoot = resolve(process.argv[2]);
const groupsRoot = join(suiteRoot, "groups");
const datasetsRoot = join(suiteRoot, "datasets");
const filePattern = process.env.SWEEP_FILE_PATTERN;
const strictLeaves = process.env.SWEEP_STRICT_LEAVES === "1";

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function casesFrom(value, file) {
  if (Array.isArray(value)) return value.flatMap((entry) => casesFrom(entry, file));
  if (!value || typeof value !== "object") return [];

  if (typeof value.expr === "string") {
    return [{ ...value, expression: value.expr, file }];
  }
  if (typeof value["expr-file"] === "string") {
    const expressionFile = join(dirname(file), value["expr-file"]);
    return [
      {
        ...value,
        expression: readFileSync(expressionFile, "utf8"),
        file: expressionFile,
      },
    ];
  }
  return [];
}

function trackedInput(value, accesses) {
  const cache = new WeakMap();

  const wrap = (item, path) => {
    if (!item || typeof item !== "object") return item;
    if (cache.has(item)) return cache.get(item);

    const proxy = new Proxy(item, {
      get(target, property, receiver) {
        const result = Reflect.get(target, property, receiver);
        if (typeof property === "symbol") return result;
        if (Array.isArray(target)) {
          return /^\d+$/.test(property) ? wrap(result, path) : result;
        }
        if (!Object.prototype.hasOwnProperty.call(target, property)) return result;
        const propertyPath = path ? `${path}.${property}` : property;
        accesses.add(propertyPath);
        return wrap(result, propertyPath);
      },
      ownKeys(target) {
        if (!Array.isArray(target)) {
          for (const property of Reflect.ownKeys(target)) {
            if (typeof property !== "string") continue;
            accesses.add(path ? `${path}.${property}` : property);
          }
        }
        return Reflect.ownKeys(target);
      },
    });
    cache.set(item, proxy);
    return proxy;
  };

  return wrap(value, "");
}

function deepestPaths(paths) {
  return [...paths].filter(
    (path) => ![...paths].some((other) => other.startsWith(`${path}.`)),
  );
}

function globMatches(patternSegments, pathSegments, patternIndex = 0, pathIndex = 0) {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegments.length;
  }

  const segment = patternSegments[patternIndex];
  if (segment === "**") {
    for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex++) {
      if (
        globMatches(
          patternSegments,
          pathSegments,
          patternIndex + 1,
          nextPathIndex,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  if (pathIndex === pathSegments.length) return false;
  if (segment !== "*" && segment !== "[*]" && segment !== pathSegments[pathIndex]) {
    return false;
  }
  return globMatches(
    patternSegments,
    pathSegments,
    patternIndex + 1,
    pathIndex + 1,
  );
}

function analyzerPathCovers(analyzerPath, runtimePath) {
  if (analyzerPath === runtimePath) return true;
  // A more-specific analyzer path safely covers an intermediate object read,
  // but a parent-only analyzer path must not hide a concrete runtime leaf.
  if (analyzerPath.startsWith(`${runtimePath}.`)) {
    return true;
  }
  if (analyzerPath.includes("%")) {
    const suffix = analyzerPath.split("%").at(-1).replace(/^\./, "");
    return !suffix || runtimePath === suffix || runtimePath.endsWith(`.${suffix}`);
  }

  const analyzerSegments = analyzerPath.split(".");
  const runtimeSegments = runtimePath.split(".");
  if (strictLeaves) return globMatches(analyzerSegments, runtimeSegments);

  const observablePatterns = analyzerSegments.flatMap((segment, index) =>
    index === analyzerSegments.length - 1 || ["*", "**", "[*]"].includes(segment)
      ? [analyzerSegments.slice(0, index + 1)]
      : [],
  );

  return observablePatterns.some((patternSegments) =>
    runtimeSegments.some((_, index) =>
      globMatches(patternSegments, runtimeSegments.slice(0, index + 1)),
    ),
  );
}

const datasetCache = new Map();
function dataset(name) {
  if (name === null || name === undefined) return undefined;
  if (!datasetCache.has(name)) {
    datasetCache.set(
      name,
      JSON.parse(readFileSync(join(datasetsRoot, `${name}.json`), "utf8")),
    );
  }
  return structuredClone(datasetCache.get(name));
}

const files = filesBelow(groupsRoot).filter((file) => extname(file) === ".json");
const upstreamCases = files.flatMap((file) => {
  if (filePattern && !file.includes(filePattern)) return [];
  try {
    return casesFrom(JSON.parse(readFileSync(file, "utf8")), file);
  } catch {
    return [];
  }
});

const mutationData = {
  config: {
    enabled: true,
    key: "bucket",
    value: 4,
    rank: 2,
    index: 0,
    operation: "apply",
    suffix: "!",
    program: "record.first.name",
    localProgram: "name",
  },
  name: "root-name",
  type: "root-type",
  total: 99,
  email: "root@example.test",
  timestamp: 0,
  items: [
    {
      id: "i1",
      name: "item-one",
      active: true,
      price: 10,
      total: 20,
      category: "a",
      children: [{ name: "child-one", active: true, rank: 2 }],
    },
    {
      id: "i2",
      name: "item-two",
      active: false,
      price: 5,
      total: 5,
      category: "b",
      children: [{ name: "child-two", active: false, rank: 1 }],
    },
  ],
  orders: [
    { id: "o1", active: true, total: 20, items: [{ name: "ordered-one" }] },
    { id: "o2", active: false, total: 5, items: [{ name: "ordered-two" }] },
  ],
  record: {
    first: { name: "first", active: true, detail: { rank: 2 } },
    second: { name: "second", active: false, detail: { rank: 1 } },
  },
  library: {
    title: "library-title",
    books: [
      { isbn: "a", title: "Book A" },
      { isbn: "b", title: "Book B" },
    ],
    loans: [
      { isbn: "a", customer: "c1" },
      { isbn: "b", customer: "c2" },
    ],
    customers: [
      { id: "c1", name: "Customer One" },
      { id: "c2", name: "Customer Two" },
    ],
  },
  Employee: [{ SSN: "s1", FirstName: "Ada", Surname: "Lovelace" }],
  Contact: [
    {
      ssn: "s1",
      Phone: [{ type: "mobile", number: "123" }],
    },
  ],
};

const mutationExpressions = new Set();
const sourceLessCarriers = [
  '"constant"',
  "1",
  "-1",
  "true",
  "null",
  "/x/",
  '("constant")',
  "(1; 2)",
  "[1, 2]",
  '{"x": 1}',
  '$string("constant")',
  "(true ? 1 : 2)",
  "$substring(?, 0, 1)",
  "function($x){$x}",
  '|Account|{"x": 1}|',
];
for (const carrier of sourceLessCarriers) {
  mutationExpressions.add(`${carrier}[$$.config.enabled]`);
  mutationExpressions.add(`${carrier}[$$.config.enabled][$$.config.rank > 0]`);
  mutationExpressions.add(`${carrier}{$$.config.key: $$.config.value}`);
  mutationExpressions.add(`${carrier}#$i[$i = 0 and $$.config.enabled]`);
  mutationExpressions.add(`${carrier}@$v[$$.config.enabled]`);
}

[
  "items@$i.name",
  "items@$i.$i.name",
  "items@$i[$i.active].name",
  "items@$i[$i.active].$i.name",
  "items@$i.children@$c[$c.active].name",
  "items@$i.children@$c[$c.active].$c.name",
  "orders@$o[$o.active] ~> $map(function($v){$v.total})",
  "orders@$o[$o.active] ~> $map(function($v){$o.total + $v.total})",
  "items@$i.($i.children[$i.active]).name",
  "items@$i.(price & $i.category)",
  "items@$i.(price)",
  "items#$i[$i = 0].name",
  "items^(>price)#$i[$i = 0].name",
  "items@$i{$i.category: $sum($i.total)}",
  "library.loans@$l.books@$b[$l.isbn = $b.isbn].title",
  "library.loans@$l.books@$b[$l.isbn = $b.isbn].$b.title",
  "library.loans@$l.books@$b[$l.isbn = $b.isbn].customers@$c[$l.customer = $c.id].name",
  "library.loans@$l.books@$b[$l.isbn = $b.isbn].customers@$c[$l.customer = $c.id].$c.name",
  "$each(function($v, $k){$k[$v]})",
  "$sift(function($v, $k){$k ~> /^c/})",
  "$map(items, function($v){$v.children[$v.active].name})",
  "$filter(items, function($v){$v.active and $$.config.enabled}).name",
  "items ~> $map(function($v){$v.name & $$.config.suffix})",
  "($f := function($v){$v.name & $$.config.suffix}; $map(items, $f))",
  "($f := function(){ $$.config.value }; items.($f()))",
  "items.$.name",
  "items.$$.config.enabled",
  "items.($x := $; $x.name)",
  "items.($x := $$; $x.config.enabled)",
  'items.("constant"[$$.config.enabled])',
  "items.([1, 2][$$.config.enabled])",
  "items.((1; 2)[$$.config.enabled])",
  "1^($$.config.rank)",
  "(1; 2)^($$.config.rank)",
  "*@$v[$v.active]",
  "record.*@$v[$v.active].name",
  "**@$v[$v.active].name",
  '$eval("items[active].name")',
  '$eval("name", items)',
  '$eval("$$.config.enabled", items)',
  "$eval(config.program)",
  "$eval(config.localProgram, record.first)",
  "$keys()",
  "$spread()",
  '$lookup("items")',
  "$clone()",
  "$string()",
  "$boolean()",
  "$sort(function($left, $right){0})",
  "$not()",
  "$keys($)",
  "$spread($)",
  "$boolean($)",
  "$not($)",
  "$clone($)",
  "$string($)",
  '$ = {"name": "root-name"}',
  '$ in [{"name": "root-name"}]',
  '{"name": "root-name"} in [$]',
  "$merge([$])",
  "$each($, function($v, $k){$k})",
  "$sift($, function($v, $k){true})",
  "record.$clone().first.name",
  "$clone().record.first.name",
  "($x := $clone(); $x.record.first.name)",
  "record.$spread().first.name",
  "$spread().record.first.name",
  "record.$keys()",
  "record.$boolean()",
  "record.first.name.$substring(1)",
  "record.first.name.$substring(1, 2)",
  'record.first.name.$substringBefore("r")',
  'record.first.name.$substringAfter("r")',
  'record.first.name.$contains("i")',
  'record.first.name.$replace("i", "I")',
  'record.first.name.$split("r")',
  "record.first.name.$pad(8)",
  "record.first.detail.rank.$power(2)",
  'record.first.detail.rank.$formatNumber("0.0")',
  'record.first.detail.rank.$formatInteger("0")',
  'record.first.name.$parseInteger("0")',
  "record.first.name.$match(/i/)",
  'timestamp.$fromMillis("[Y0001]")',
  "$each(record, function($v){$v.name})",
  "$sift(record, function($v){$v.active})",
  "record.$each(function($v){$v.name})",
  "record.$sift(function($v){$v.active})",
  '(record).(first).detail.(rank)',
  'library.loans@$l.books[$l.isbn=isbn].{"title":title,"customer":$l.customer}',
  'library.loans@$l.books@$b[$l.isbn=$b.isbn].customers[$l.customer=id].{"name":name}',
  'Employee@$e.(Contact)[ssn=$e.SSN].{"phone":Phone[type="mobile"].number}',
  "($f := function($x)<o-:x>{$x.record.first.name}; $f())",
  "(function($x)<o-:x>{$x.record.first.name})()",
  "($f := function($x)<o-:o>{$x}; $f().record.first.name)",
  "record.($f := function($x)<o-:x>{$x.first.name}; $f())",
  '(($f := function($prefix, $x)<so-:x>{$x.record.first.name}; $f("ignored")))',
  '(($f := function($x, $suffix)<o-s:x>{$x.record.first.name}; $f("ignored")))',
  "($f := function($x)<o-:x>{$x.first.name}; record.$f())",
  "($f := function($x)<o-:x>{$x.active}; items[$f()].name)",
  "($f := function($x)<o-:x>{$x.rank}; items^(<$f()).name)",
  '($f := function($x)<o-:x>{$x.category}; items{$f(): "x"})',
  "($f := function($x)<o-:x>{$x.active}; items.($f()))",
  '($t := |first|{"seen": name}|; 1)',
  '($t := |first|{"seen": name}|; $t(record))',
  '($t := |first|{"seen": name}|; $t(record).first.seen)',
  '($t := |first|{"seen": name}|; $t(record).second.name)',
  '($t := |first|{"seen": name}|; record ~> $t())',
  '($t := |first|{"seen": name}|; record.$t($))',
  '($suffix := config.suffix; $t := |first|{"seen": $suffix}|; $t(record))',
  '($t := |record.first|{"seen": name}|; $t($))',
  '($t := |first|{"seen": detail}|; $t(record).first.seen.rank)',
  '($t := |first|{"seen": {"rank": detail.rank}}|; $t(record).first.seen.rank)',
  '($t := |first|{"seen": name}|; $map([record], $t))',
  '($t := |first|{"seen": name}|; $map([record], $t).first.seen)',
  '($t := |first|{"seen": detail}|; $map([record], $t).first.seen.rank)',
  '($t := |first|{"seen": name}|; [record] ~> $map($t))',
  '(config.enabled ? |first|{"seen": detail}| : |first|{"seen": name}|)(record).first.seen.rank',
  '|first|{"seen": name}|(record)',
  '(|first|{"seen": name}|)(record)',
  '|first|{"seen": name}|(record).first.seen',
  '($p := |first|{"seen": name}|(?); $p(record))',
  '($p := |first|{"seen": name}|(?); $p(record).first.seen)',
  '($p := function($x, $unused){$x.first.name}(?, 1); $p(record))',
  '(config.enabled ? |first|{"seen": name}| : function($x){$x})(record)',
  '($p := (config.enabled ? |first|{"seen": name}| : function($x){$x})(?); $p(record))',
  '($p := (config.enabled ? |first|{"seen": name}| : function($x){$x})(?); 1)',
  '($maker := function(){|first|{"seen": name}|}; $maker())',
  '($maker := function(){|first|{"seen": name}|}; $maker()(record))',
  '(function(){|first|{"seen": name}|})()(record)',
  '($maker := function($flag){$flag ? |first|{"seen": name}| : function($x){$x}}; $maker(config.enabled)(record))',
  '($maker := function(){function($x){$x.first.name}}; $maker()(record))',
  '($maker := function($suffix){function($x){$x.name & $suffix}}; $maker(config.suffix)(record.first))',
  '($maker := function($suffix){|first|{"seen": $suffix}|}; $maker(config.suffix)(record))',
  '($maker := function(){($t := |first|{"seen": name}|; $t)}; $maker()(record))',
  '($project := function($x){$x.first.name}; $maker := function(){$project(?)}; $maker()(record))',
  '($transforms := [|first|{"seen": name}|]; 1)',
  '($transforms := [|first|{"seen": name}|]; $transforms[0](record))',
  '($transforms := [|first|{"seen": name}|]; $transforms[config.index](record))',
  '({"apply": |first|{"seen": name}|}.apply)(record)',
  '($operations := {"apply": |first|{"seen": name}|}; $operations.apply(record))',
  '($operations := {"apply": |first|{"seen": detail}|}; $operations.apply(record).first.seen.rank)',
  '$lookup({"apply": |first|{"seen": name}|}, "apply")(record)',
  '($operations := {"apply": |first|{"seen": name}|}; $lookup($operations, config.operation)(record))',
  '($functions := [function($x){$x.first.name}]; $functions[0](record))',
  '($functions := {"project": function($x){$x.first.name}}; $functions.project(record))',
  '$map(items, function($v, $i, $a){$a.children.name})',
  '$filter(items, function($v, $i, $a){$a.active}).name',
  '$single(items, function($v, $i, $a){$v.id = "i1" and $a.active}).name',
  '$reduce(items, function($acc, $v, $i, $a){$append($acc, $a.children.name)}, [])',
  '$each(record, function($v, $k, $o){$o.*.detail.rank})',
  '$sift(record, function($v, $k, $o){$o.*.detail.rank}).*.name',
  '($f := function($v, $i, $a){$a.children.name}; $map(items, $f))',
  '($f := function($acc, $v, $i, $a){$append($acc, $a.children.name)}; $reduce(items, $f, []))',
  '($f := function($v, $k, $o){$o.*.detail.rank}; $each(record, $f))',
  '($f := function($v, $k, $o){$o.*.detail.rank}; $sift(record, $f).*.name)',
  '($x := [record.first, record.second]; $x) ~> $filter(function($v){$v.active}) ~> $reverse() ~> $map(function($v){$v.detail.rank})',
  '($make := function(){[record.first, record.second]}; $sort($make(), function($l, $r){$l.detail.rank > $r.detail.rank}).name)',
  '([record.first, record.second] ~> $append([]) ~> $distinct()).detail.rank',
  '([] ~> $append([record.first, record.second]) ~> $shuffle()).detail.rank',
  '($add := $append(?, []); $reverse($add([record.first, record.second])).detail.rank)',
  '($make := function(){[record.first, record.second] ~> $append([])}; $make().detail.rank)',
  '$filter(config.enabled ? [record.first] : [record.second], function($v){$v.active}).detail.rank',
  '$map(($x := [record.first, record.second]; $x), function($v){$v.detail.rank})',
  '$sift(($o := record; $o), function($v, $k, $all){$all.*.active}).*.detail.rank',
  '$each(($o := record; $o), function($v, $k, $all){$all.*.detail.rank})',
  '($maker := function(){record}; $sift($maker(), function($v, $k, $all){$all.*.active}).*.detail.rank)',
  '($maker := function(){record}; $each($maker(), function($v, $k, $all){$all.*.detail.rank}))',
  '($callbacks := {"map": function($v, $i, $a){$a.children.name}}; $map(items, $callbacks.map))',
  '($callbacks := [function($v, $i, $a){$a.children.name}]; $map(items, $callbacks[0]))',
  '$map(items, $lookup({"map": function($v, $i, $a){$a.children.name}}, "map"))',
  '($callbacks := {"each": function($v, $k, $o){$o.*.detail.rank}}; $each(record, $callbacks.each))',
  '($callbacks := {"sift": function($v, $k, $o){$o.*.active}}; $sift(record, $callbacks.sift).*.detail.rank)',
].forEach((expression) => mutationExpressions.add(expression));

const mutationCases = [...mutationExpressions].map((expression, index) => ({
  expression,
  data: mutationData,
  file: `<mutation-${String(index + 1).padStart(3, "0")}>`,
}));

const selectedMutationCases = filePattern ? [] : mutationCases;
const cases = [...upstreamCases, ...selectedMutationCases];

const failures = [];
const analyzerFailures = [];
let evaluated = 0;
for (const testCase of cases) {
  if (testCase.code || testCase.timelimit || testCase.depth) continue;

  let input;
  try {
    input = Object.hasOwn(testCase, "data")
      ? structuredClone(testCase.data)
      : dataset(testCase.dataset);
  } catch {
    continue;
  }

  const accesses = new Set();
  try {
    const expression = jsonata(testCase.expression);
    await expression.evaluate(
      trackedInput(input, accesses),
      testCase.bindings ?? {},
    );
  } catch {
    continue;
  }
  evaluated += 1;

  let analyzerPaths;
  try {
    analyzerPaths = extractPaths(testCase.expression).map(({ path }) => path);
  } catch (error) {
    analyzerFailures.push({
      file: testCase.file,
      expression: testCase.expression,
      error: error instanceof Error ? error.message : String(error),
    });
    continue;
  }
  const runtimePaths = deepestPaths(accesses);
  const uncovered = runtimePaths.filter(
    (runtimePath) =>
      !analyzerPaths.some((analyzerPath) =>
        analyzerPathCovers(analyzerPath, runtimePath),
      ),
  );
  if (uncovered.length > 0) {
    failures.push({
      file: testCase.file,
      expression: testCase.expression,
      analyzerPaths,
      runtimePaths,
      uncovered,
    });
  }
}

console.log(
  JSON.stringify(
    {
      suiteRoot,
      upstreamCases: upstreamCases.length,
      mutationCases: selectedMutationCases.length,
      cases: cases.length,
      evaluated,
      analyzerFailures,
      failures,
    },
    null,
    2,
  ),
);
