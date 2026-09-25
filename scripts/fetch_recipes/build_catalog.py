"""Build the embedded planner catalog from game Docs and a validated FRM snapshot."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path


def build(docs_path, snapshot):
    raw = docs_path.read_bytes()
    groups = json.loads(raw.decode("utf-16"))
    classes = {c["ClassName"]: c for group in groups for c in group["Classes"]}
    resource_ids = {c["ClassName"] for group in groups if "FGResourceDescriptor" in group["NativeClass"] for c in group["Classes"]}
    recipes = json.loads((snapshot / "recipes.json").read_text())
    item_ids = sorted({i["itemId"] for r in recipes for i in r["ingredients"] + r["products"]})
    machine_ids = sorted({m for r in recipes for m in r["producedIn"] if m.startswith("Build_")})
    items = []
    for item_id in item_ids:
        c = classes[item_id]
        items.append({"id": item_id, "name": c["mDisplayName"], "form": {"RF_LIQUID": "liquid", "RF_GAS": "gas"}.get(c["mForm"], "solid"), "resource": item_id in resource_ids, "sinkable": float(c.get("mResourceSinkPoints", 0)) > 0})
    machines = []
    for machine_id in machine_ids + ["Build_MinerMk1_C", "Build_MinerMk2_C", "Build_MinerMk3_C", "Build_OilPump_C", "Build_WaterPump_C"]:
        c = classes[machine_id]
        machines.append({"id": machine_id, "name": c["mDisplayName"], "power": float(c["mPowerConsumption"]), "powerExponent": float(c["mPowerConsumptionExponent"]), "boostPowerExponent": float(c["mProductionBoostPowerConsumptionExponent"]), "boostSlots": int(c["mProductionShardSlotSize"]) if c["mCanChangeProductionBoost"] == "True" else 0, "boostPerSlot": float(c["mProductionShardBoostMultiplier"]), "variablePower": "mEstimatedMaximumPowerConsumption" in c, "minClock": 1.0, "maxClock": 250.0 if c["mCanChangePotential"] == "True" else 100.0})
    normalized = []
    for recipe in recipes:
        c = classes[recipe["id"]]
        if not math.isclose(float(c["mManufactoringDuration"]), recipe["durationSeconds"], rel_tol=1e-6):
            raise ValueError(f"{recipe['id']}: Docs and FRM durations disagree")
        for docs_key, key in (("mIngredients", "ingredients"), ("mProduct", "products")):
            expected = {}
            for item_id, amount in re.findall(r"\.([A-Za-z0-9_]+)'\",Amount=([0-9.]+)", c[docs_key]):
                divisor = 1000 if classes[item_id]["mForm"] in ("RF_LIQUID", "RF_GAS") else 1
                expected[item_id] = float(amount) / divisor
            actual = {a["itemId"]: a["amount"] for a in recipe[key]}
            if actual.keys() != expected.keys() or any(not math.isclose(v, expected[k], rel_tol=1e-6) for k, v in actual.items()):
                raise ValueError(f"{recipe['id']}: Docs and FRM {key} disagree")
        normalized.append({"id": recipe["id"], "name": recipe["name"], "alternate": recipe["alternate"], "duration": float(c["mManufactoringDuration"]), "machineIds": [m for m in recipe["producedIn"] if m.startswith("Build_")], "ingredients": [{"itemId": i["itemId"], "amount": i["amount"]} for i in recipe["ingredients"]], "products": [{"itemId": i["itemId"], "amount": i["amount"]} for i in recipe["products"]], "powerConstant": float(c["mVariablePowerConsumptionConstant"]), "powerFactor": float(c["mVariablePowerConsumptionFactor"])})
    belts = [float(classes[f"Build_ConveyorBeltMk{i}_C"]["mSpeed"]) / 2 for i in range(1, 7)]
    pipes = [float(classes[c]["mFlowLimit"]) * 60 for c in ("Build_Pipeline_C", "Build_PipelineMK2_C")]
    return {"version": hashlib.sha256(raw + json.dumps(normalized, sort_keys=True).encode()).hexdigest()[:16], "sourceHash": hashlib.sha256(raw).hexdigest(), "items": items, "machines": machines, "recipes": normalized, "belts": belts, "pipes": pipes, "unlocks": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = build(args.docs, args.snapshot)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Catalog {result['version']}: {len(result['recipes'])} recipes, {len(result['items'])} items, {len(result['machines'])} machines")


if __name__ == "__main__":
    main()
