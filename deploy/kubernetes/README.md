# Kubernetes

Reference `deploy/kubernetes/base` from an immutable commit in a Kustomize overlay.
The overlay supplies its namespace, routing, storage and resource overrides,
`PIONEER_HQ_EXTERNAL_URL`, and a pinned `PIONEER_HQ_ASSETS_REF` OCI artifact in the
`pioneer-hq` ConfigMap. The asset reference is required by the seed container.
Select the `ghcr.io/saffronjam/pioneer-hq` and
`ghcr.io/saffronjam/pioneer-hq-seed` images through Kustomize `images`.

The base runs one server on port 8081 with `/healthz` probes. SQLite lives at
`/data/pioneer-hq.db` on the data claim; map tiles and icons live on the assets
claim. Use storage suitable for SQLite. The seed init container populates assets
before the server starts. Preserve the database path when binding existing data.

Render without deploying:

```sh
kubectl kustomize deploy/kubernetes/base
```
