# Icon scraper

Scrapes item and building icons from satisfactory.wiki.gg and renders them at every resolution the
dashboard uses.

| File | Purpose |
| --- | --- |
| `extract_images_wiki_gg.py` | crawls the wiki, writes `image_source.json` |
| `download_images.py` | downloads every URL in the manifest into `downloads/` |
| `scale_images.py` | renders each image at every resolution into `output/<size>/` |
| `extract_item_colors.py` | derives planner item accents from the installed 64x64 icons |
| `justfile` | the recipes below |

## Flow

```
wiki pages  ──extract_images_wiki_gg.py──>  image_source.json
             ──download_images.py───────>  downloads/
             ──scale_images.py──────────>  output/<size>/
             ──prod─────────────────────>  dashboard/public/assets/images/satisfactory/<size>/
```

## Recipes

```bash
just scrape-images scrape      # rebuild image_source.json from the wiki
just scrape-images dry-run     # crawl without writing the manifest
just scrape-images download    # fetch everything in the manifest
just scrape-images scale       # re-render sizes from downloads/ (no re-download)
just scrape-images prod        # scale, then copy into dashboard/public
just scrape-images colors      # regenerate planner item accents from installed icons
just scrape-images clean       # drop venv/ and downloads/
```

Full refresh: `scrape` → `download` → `prod`.

`prod` also writes `dashboard/src/sections/calculator/item-colors.json`. Item accents are
precomputed so diagram interactions do not need to read image pixels.

## Notes

- `scale_images.py` also produces 512x512 and the originals; only 16x16 through 256x256 are copied to
  the dashboard by `prod`. The rest stay in `output/` as an archive.
- `prod` replaces each size directory outright, so removing an icon upstream removes it here.
- Both `output/` and the dashboard's asset directories are gitignored — `just pack-assets` at the repo
  root is what turns them into the committed git-lfs tarballs.
