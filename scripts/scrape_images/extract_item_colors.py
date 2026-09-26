#!/usr/bin/env python3
"""Generate stable planner accents from the bundled item icons."""

import colorsys
import json
import math
from pathlib import Path

from PIL import Image


def item_color(path: Path) -> str:
    """Choose the strongest hue family, ignoring transparency and deep shadows."""
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        data = rgba.load()
        pixels = [data[x, y] for y in range(rgba.height) for x in range(rgba.width)]
    samples = []
    weights = [0.0] * 24
    for red, green, blue, alpha in pixels:
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        if alpha < 128 or saturation < 0.2 or value < 0.2:
            continue
        bucket = int(hue * 24) % 24
        weight = saturation * value * alpha / 255
        weights[bucket] += weight
        samples.append((hue, saturation, weight, bucket))
    if not samples:
        return "#a3a3a3"
    dominant = max(range(24), key=lambda bucket: weights[bucket])
    family = [sample for sample in samples if (sample[3] - dominant) % 24 in (0, 1, 23)]
    total = sum(sample[2] for sample in family)
    x = sum(math.cos(hue * math.tau) * weight for hue, _, weight, _ in family)
    y = sum(math.sin(hue * math.tau) * weight for hue, _, weight, _ in family)
    hue = (math.atan2(y, x) / math.tau) % 1
    saturation = sum(saturation * weight for _, saturation, weight, _ in family) / total
    rgb = colorsys.hls_to_rgb(hue, 0.65, min(0.65, max(0.28, saturation)))
    return "#" + "".join(f"{round(channel * 255):02x}" for channel in rgb)


def main() -> None:
    """Write colors for catalog items whose icons are available locally."""
    root = Path(__file__).resolve().parents[2]
    catalog = json.loads((root / "api/internal/planner/catalog.json").read_text())
    icons = root / "dashboard/public/assets/images/satisfactory/64x64"
    colors = {}
    missing = []
    for item in catalog["items"]:
        path = icons / f"{item['name']}.png"
        if path.is_file():
            colors[item["name"]] = item_color(path)
        else:
            missing.append(item["name"])
    if not colors:
        raise SystemExit("No item icons found. Unpack the assets first.")
    output = root / "dashboard/src/sections/calculator/item-colors.json"
    output.write_text(json.dumps(colors, indent=2, sort_keys=True) + "\n")
    print(f"Generated {len(colors)} item colors; {len(missing)} missing icons use neutral accents.")


if __name__ == "__main__":
    main()
