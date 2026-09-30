# Kubernetes deployment

`base/` is a portable Kustomize build root. It owns the Deployment, Service,
application ConfigMap and data/assets claims. Keep commands, probes, ports,
environment variables and mount paths consistent with the application contract.
The seed container writes the assets claim; the server mounts it read-only.
Run one replica with a Recreate strategy for SQLite and writable assets.

Environment overlays own namespaces, selected server/seed versions, the required
`PIONEER_HQ_ASSETS_REF`, external URL, resource sizing, storage class/bindings,
routes and access policies. Do not embed home LAN addresses or domains here.
Changing a database filename requires an explicit data operation; an environment
may override `PIONEER_HQ_DB_PATH` to match its durable storage contract.

Render with `kubectl kustomize deploy/kubernetes/base`. Verify overlays preserve
Service selectors, ConfigMap references and both claims. The GraphQL endpoint
uses WebSockets; environment routing must allow long-lived connections.
