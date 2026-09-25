"""Fetch an FRM recipe snapshot and extract a normalized production sample."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


SAMPLE_IDS = (
    "Recipe_IngotIron_C",
    "Recipe_IronPlate_C",
    "Recipe_IronRod_C",
    "Recipe_Screw_C",
    "Recipe_IronPlateReinforced_C",
    "Recipe_Alternate_Screw_C",
    "Recipe_Plastic_C",
    "Recipe_AluminaSolution_C",
    "Recipe_AluminumScrap_C",
    "Recipe_Alternate_DarkMatter_Crystallization_C",
)


def fetch(base_url, endpoint):
    request = Request(base_url + "/" + endpoint, headers={"Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        data = json.load(response)
    if not isinstance(data, list) or not data or not all(isinstance(row, dict) for row in data):
        raise ValueError(f"{endpoint} must return a nonempty array of objects")
    return data


def positive_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{label} must be finite and positive")
    return value


def normalize(recipe, schematics):
    recipe_id = recipe["ClassName"]
    duration = positive_number(recipe["FactoryDuration"], f"{recipe_id} duration")
    result = {
        "id": recipe_id,
        "name": recipe["Name"],
        "category": recipe["Category"],
        "durationSeconds": duration,
        "producedIn": recipe["ProducedIn"],
        "events": recipe["Events"],
        "alternate": any(s["Type"] == "Alternate" for s in schematics),
        "unlocked": any(s["Purchased"] for s in schematics) if schematics else None,
        "schematicIds": sorted(s["ClassName"] for s in schematics),
    }
    for source, target in (("Ingredients", "ingredients"), ("Products", "products")):
        result[target] = []
        for item in recipe[source]:
            amount = positive_number(item["Amount"], f"{recipe_id} {item['ClassName']} amount")
            rate = positive_number(item["FactoryRate"], f"{recipe_id} {item['ClassName']} rate")
            if not math.isclose(rate, amount * 60 / duration, rel_tol=1e-6, abs_tol=1e-6):
                raise ValueError(f"{recipe_id}: {item['ClassName']} amount/duration disagrees with FactoryRate")
            result[target].append({
                "itemId": item["ClassName"],
                "name": item["Name"],
                "amount": amount,
                "perMinute": rate,
            })
    if not result["products"]:
        raise ValueError(f"{recipe_id} has no products")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", help="FRM base URL or host:port")
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "output")
    args = parser.parse_args()
    if args.sample_size < 1:
        parser.error("--sample-size must be positive")
    base_url = args.address.rstrip("/")
    if "://" not in base_url:
        base_url = "http://" + base_url
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.query or url.fragment or url.username:
        parser.error("address must be an HTTP(S) base URL without credentials, query, or fragment")

    recipes = fetch(base_url, "getRecipes")
    schematics = fetch(base_url, "getSchematics")
    output = args.output / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    output.mkdir(parents=True)

    def write(name, value):
        (output / name).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")

    write("recipes.raw.json", recipes)
    write("schematics.raw.json", schematics)
    by_recipe = defaultdict(list)
    for schematic in schematics:
        for recipe in schematic["Recipes"]:
            by_recipe[recipe["ClassName"]].append(schematic)

    automated = []
    errors = []
    seen = set()
    for recipe in recipes:
        recipe_id = recipe["ClassName"]
        if recipe_id in seen:
            errors.append(f"Duplicate recipe: {recipe_id}")
            continue
        seen.add(recipe_id)
        if not any(machine.startswith("Build_") for machine in recipe["ProducedIn"]):
            continue
        try:
            automated.append(normalize(recipe, by_recipe[recipe_id]))
        except (KeyError, TypeError, ValueError) as error:
            errors.append(f"{recipe_id}: {error}")

    automated.sort(key=lambda recipe: recipe["id"])
    indexed = {recipe["id"]: recipe for recipe in automated}
    preferred = [indexed[key] for key in SAMPLE_IDS if key in indexed]
    preferred_ids = {recipe["id"] for recipe in preferred}
    sample = (preferred + [r for r in automated if r["id"] not in preferred_ids])[:args.sample_size]
    summary = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "rawRecipes": len(recipes),
        "schematics": len(schematics),
        "schematicTypes": dict(sorted(Counter(s["Type"] for s in schematics).items())),
        "automatedRecipes": len(automated),
        "alternateRecipes": sum(r["alternate"] for r in automated),
        "unlockedRecipes": sum(r["unlocked"] is True for r in automated),
        "unknownUnlockStatus": sum(r["unlocked"] is None for r in automated),
        "sampleSize": len(sample),
        "validationErrors": errors,
    }
    write("recipes.json", automated)
    write("sample.json", sample)
    write("summary.json", summary)
    print(json.dumps(summary, indent=2))
    print(f"\nSnapshot: {output}")
    for recipe in sample:
        products = ", ".join(f"{p['name']} {p['perMinute']:g}/min" for p in recipe["products"])
        status = "unlocked" if recipe["unlocked"] else "locked" if recipe["unlocked"] is False else "unknown unlock status"
        print(f"  {recipe['name']} ({status}): {products}")
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, URLError, ValueError, KeyError, TypeError) as error:
        print(f"Fetch failed: {error}", file=sys.stderr)
        sys.exit(1)
