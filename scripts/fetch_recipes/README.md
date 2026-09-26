# FRM recipe snapshots

Fetch recipes and schematics from a running save with Ficsit Remote Monitoring enabled:

```sh
just fetch-recipes fetch <host:port>
just fetch-recipes fetch <host:port> 10
```

Requires Python 3 with venv support. Uses the standard library and makes two sequential,
read-only HTTP requests. Each run creates a timestamped directory under the ignored `output/`:

| File | Contents |
| --- | --- |
| `recipes.raw.json` | Complete `/getRecipes` response, including building and manual recipes |
| `schematics.raw.json` | Complete `/getSchematics` response, including locked schematics |
| `recipes.json` | Normalized recipes with at least one `Build_` producer |
| `sample.json` | Up to 10 production recipes, prioritizing standard, alternate, fluid, and byproduct examples |
| `summary.json` | Counts, capture time, and validation failures |

Recipe and item IDs use game class names. Alternate status comes from schematic type;
unlock status is true when any associated schematic is purchased, or null when there is no
mapping. These flags describe schematic unlocks, not event availability or every gameplay restriction.

Amounts and rates retain FRM's converted units. Every normalized ingredient and product is
checked against `amount * 60 / FactoryDuration`. Fluids must not be divided by 1,000 again.
Item form, machine power, and game/mod version metadata are not provided by this export.
The `Build_` producer filter is a discovery heuristic for vanilla production machines.

Raw responses are retained when recipe validation fails; invalid production recipes are reported
in the summary and cause a nonzero exit. Snapshots remain local and are not committed.

Build the dashboard's embedded planning catalog by combining a snapshot with game metadata:

```sh
python3 scripts/fetch_recipes/build_catalog.py \
  --docs /path/to/Satisfactory/CommunityResources/Docs/en-US.json \
  --snapshot scripts/fetch_recipes/output/<capture> \
  --output api/internal/planner/catalog.json
```

The metadata builder validates quantities and durations against the snapshot, handles the game
Docs' fluid-unit conversion, and adds material forms, construction recipe costs, power coefficients, Somersloop slots, and
belt/pipe capacities. Recipe alternate classification comes from the game Docs recipe name; a schematic can unlock supporting recipes as well as its alternate. The catalog records the Docs source hash.
