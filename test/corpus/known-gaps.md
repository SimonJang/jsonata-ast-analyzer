# Known Analyzer Gaps Found During Corpus Hardening

These cases are intentionally excluded from the passing 500+ fixture corpus.
Each one is tracked as a separate follow-up issue linked from #17 and PR #18.

## #19 Root `$` references in path extraction

Category: root reference / path variable handling

Failure type: false negative

Expression:

```jsonata
$.customer.name
```

Expected paths:

```json
[
  { "path": "customer.name", "confidence": "static" }
]
```

Actual paths:

```json
[]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/19

## #20 Computed object keys

Category: object constructors / projection keys / transform update keys

Failure type: false negative

Expression:

```jsonata
{customer.id: customer.name}
```

Expected paths:

```json
[
  { "path": "customer.id", "confidence": "static" },
  { "path": "customer.name", "confidence": "static" }
]
```

Actual paths:

```json
[
  { "path": "customer.name", "confidence": "static" }
]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/20

## #21 Scalar function result property chaining

Category: function result chaining

Failure type: false positive

Expression:

```jsonata
$substring(customer.name, 0, 3).length
```

Expected paths:

```json
[
  { "path": "customer.name", "confidence": "static" }
]
```

Actual paths:

```json
[
  { "path": "customer.name.length", "confidence": "static" },
  { "path": "customer.name", "confidence": "static" }
]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/21

## #22 Variable-bound callbacks passed to higher-order functions

Category: higher-order functions / custom function values

Failure type: false negative

Expression:

```jsonata
($project := function($v){ $v.name }; $map(items, $project))
```

Expected paths:

```json
[
  { "path": "items", "confidence": "static" },
  { "path": "items.name", "confidence": "static" }
]
```

Actual paths:

```json
[
  { "path": "items", "confidence": "static" }
]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/22

## #23 Variables bound to constructed values

Category: variable bindings / constructed values

Failure type: false positive

Expression:

```jsonata
($o := {"x": account.name}; $o.x)
```

Expected paths:

```json
[
  { "path": "account.name", "confidence": "static" }
]
```

Actual paths:

```json
[
  { "path": "account.name", "confidence": "static" },
  { "path": "account.name.x", "confidence": "static" }
]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/23

## #24 Variables bound to scalar indexes

Category: dynamic brackets / variable bindings

Failure type: false positive / confidence classification problem

Expression:

```jsonata
($i := 0; items[$i].name)
```

Expected paths:

```json
[
  { "path": "items.name", "confidence": "static" }
]
```

Actual paths:

```json
[
  { "path": "items.name", "confidence": "static" },
  { "path": "items[*]", "confidence": "dynamic" }
]
```

Issue: https://github.com/SimonJang/jsonata-ast-analyzer/issues/24
