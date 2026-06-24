import { __benchmarkExpression } from "../dist/index.js";

const fixtures = [
  "library.loans@$l.books@$b[$l.isbn=$b.isbn].{\"title\":$b.title,\"customer\":$l.customer}",
  "$map(Account.Order.Product, function($p) { $p.Price * $p.Quantity })",
  "payload ~> |Account.Order.Product|{\"Price\": Price * 1.2}|",
  "items[active].{\"value\": price ?: fallback}",
  "$contains(Customer.Email, /@example\\.com$/) and $match(description, /urgent/i)",
];

const maxDurationMs = Number(process.env.JSONATA_BENCH_MAX_MS ?? 1000);
let failed = false;

for (const expression of fixtures) {
  const stats = __benchmarkExpression(expression);
  const duration = stats.durationMs.toFixed(3);
  console.log(
    `${duration}ms raw=${stats.rawPathCount} unique=${stats.uniquePathCount} ${expression}`,
  );
  if (stats.durationMs > maxDurationMs) failed = true;
}

if (failed) {
  console.error(`Benchmark smoke exceeded ${maxDurationMs}ms`);
  process.exit(1);
}
