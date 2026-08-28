export const smokeFixtures = [
  "library.loans@$l.books@$b[$l.isbn=$b.isbn].{\"title\":$b.title,\"customer\":$l.customer}",
  "$map(Account.Order.Product, function($p) { $p.Price * $p.Quantity })",
  "payload ~> |Account.Order.Product|{\"Price\": Price * 1.2}|",
  "items[active].{\"value\": price ?: fallback}",
  "$contains(Customer.Email, /@example\\.com$/) and $match(description, /urgent/i)",
];

export const scalingFixtures = {
  "long-path": (size) =>
    Array.from({ length: size }, (_, index) => `f${index}`).join("."),
  "wide-binary": (size) =>
    Array.from({ length: size }, (_, index) => `f${index}`).join(" + "),
  "wide-object": (size) =>
    `{${Array.from(
      { length: size },
      (_, index) => `"k${index}": f${index}`,
    ).join(",")}}`,
  "many-bindings": (size) =>
    `(${Array.from(
      { length: size },
      (_, index) => `$v${index} := root.f${index}`,
    ).join(";")}; $v${size - 1})`,
  "alias-chain": (size) =>
    `($v0 := root; ${Array.from(
      { length: size - 1 },
      (_, index) => `$v${index + 1} := $v${index}.f${index}`,
    ).join(";")}; $v${size - 1})`,
  "wide-filter": (size) =>
    `items[${Array.from(
      { length: size },
      (_, index) => `f${index}`,
    ).join(" and ")}]`,
  "repeated-path": (size) =>
    Array.from({ length: size }, () => "root.same").join(" + "),
};

export const productionShapedFixtures = {
  "conditional-nested-projection": `(
    $source := event.kind = "primary" ? $$.primary.stop : $$.fallback.stop;
    $source.{
      "identifier": $.id,
      "location": $.location.{
        "name": $.name,
        "address": $.address.{"city": $.city, "country": $.country}
      }
    }
  )`,
  "stored-callback-chain": `(
    $read := function($entry) { $entry.details.value ?: defaults.value };
    $active := function($entry) { $entry.status = "active" };
    $callbacks := [$read, $active];
    $selected := $filter(records, $callbacks[1]);
    $map($selected, $callbacks[0])
  )`,
  "resolver-branching": `(
    $project := function($entry) {{
      "id": $entry.id,
      "value": $entry.details.value,
      "children": $map($entry.children, function($child) {{
        "id": $child.id,
        "value": $child.details.value
      }})
    }};
    $source := flags.usePrimary ? $$.primary.records : $$.fallback.records;
    $map($source, $project)
  )`,
};
