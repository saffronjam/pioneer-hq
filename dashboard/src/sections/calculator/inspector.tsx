import { ChoiceSelect, MaterialSelect } from './pickers';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  PlannerDocument,
  PlannerNode,
  PlannerWorkspace,
  PlannerCalculation,
} from '@/services/plannerApi';
import { ancestors, inherited, number, reparent } from './model';

export const selectClass = 'w-full';
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Numeric({
  value,
  change,
  min = 0,
  max = 1e9,
}: {
  value: number;
  change: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      step="any"
      value={value}
      onChange={(e) => {
        if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber))
          change(Math.max(min, Math.min(max, e.target.valueAsNumber)));
      }}
    />
  );
}

export function Inspector({
  doc,
  selected,
  workspace,
  calculation,
  edit,
  remove,
}: {
  doc: PlannerDocument;
  selected: string;
  workspace: PlannerWorkspace;
  calculation?: PlannerCalculation;
  edit: (d: PlannerDocument, expand?: boolean) => void;
  remove: () => void;
}) {
  const [product, setProduct] = useState('');
  const n = doc.nodes.find((n) => n.id === selected);
  const edge = doc.connections.find((e) => e.id === selected);
  const r = calculation?.nodes.find((r) => r.nodeId === selected);
  const { catalog } = workspace;
  const patch = (p: Partial<PlannerNode>, expand = false) =>
    edit({ ...doc, nodes: doc.nodes.map((v) => (v.id === selected ? { ...v, ...p } : v)) }, expand);
  const scope = n?.kind === 'group' ? n.id : '';
  const policy = n?.kind === 'group' ? n.settings : doc.settings;
  const effective = inherited(doc, scope);
  const changePolicy = (p: Partial<typeof policy>, expand = false) =>
    n
      ? patch({ settings: { ...policy, ...p } }, expand)
      : edit({ ...doc, settings: { ...policy, ...p } }, expand);
  const machine = catalog.machines.find((m) => m.id === n?.machineId);
  const diagnostics =
    calculation?.diagnostics.filter(
      (d) => d.nodeId === selected || (edge && d.connectionId === selected)
    ) ?? [];
  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <h2 className="font-semibold">
          {edge
            ? 'Material connection'
            : n?.kind === 'group'
              ? 'Factory section'
              : n
                ? 'Node details'
                : 'Diagram settings'}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {n?.kind === 'group'
            ? 'Policies apply inside this section.'
            : !n && !edge
              ? ''
              : 'Changes are saved automatically.'}
        </p>
      </div>
      {!edge && (
        <Field label="Name">
          <Input
            value={n?.name ?? doc.name}
            onChange={(e) =>
              n ? patch({ name: e.target.value }) : edit({ ...doc, name: e.target.value })
            }
          />
        </Field>
      )}
      {n && (
        <>
          <Field label="Construction status">
            <ChoiceSelect
              className={selectClass}
              value={n.status}
              onChange={(e) => patch({ status: e.target.value })}
            >
              {['planned', 'building', 'built'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </ChoiceSelect>
          </Field>
          {n.kind === 'group' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                edit({
                  ...doc,
                  nodes: doc.nodes.map((v) =>
                    ancestors(doc, v.id).includes(n.id) ? { ...v, status: n.status } : v
                  ),
                })
              }
            >
              Apply status to all children
            </Button>
          )}
          <Field label="Containing section">
            <ChoiceSelect
              className={selectClass}
              value={n.parentId}
              onChange={(e) => edit(reparent(doc, [n.id], e.target.value), true)}
            >
              <option value="">Main diagram</option>
              {doc.nodes
                .filter(
                  (v) => v.kind === 'group' && v.id !== n.id && !ancestors(doc, v.id).includes(n.id)
                )
                .map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
            </ChoiceSelect>
          </Field>
          {['output', 'supply'].includes(n.kind) && (
            <Field
              label={
                n.kind === 'output' ? 'Requested output / minute' : 'Available supply / minute'
              }
            >
              <Numeric value={n.rate} change={(rate) => patch({ rate })} />
            </Field>
          )}
          {['input', 'supply'].includes(n.kind) && (
            <Field label="Source type">
              <ChoiceSelect
                className={selectClass}
                value={n.kind}
                onChange={(e) => patch({ kind: e.target.value, machineId: '', generated: false })}
              >
                <option value="input">Required input from parent</option>
                <option value="supply">Input</option>
              </ChoiceSelect>
            </Field>
          )}
          {n.kind === 'supply' && (
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={n.fixedSupply}
                onChange={(e) => patch({ fixedSupply: e.target.checked })}
              />
              Fixed incoming rate (report surplus)
            </label>
          )}
          {n.kind === 'production' && (
            <>
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="font-medium">
                  {catalog.recipes.find((v) => v.id === n.recipeId)?.name}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Recipe selected by {doc.nodes.find((v) => v.id === n.parentId)?.name || 'diagram'}{' '}
                  policies.
                </p>
              </div>
              <Field label="Machine">
                <ChoiceSelect
                  className={selectClass}
                  value={n.machineId}
                  onChange={(e) => patch({ machineId: e.target.value, somersloops: 0 })}
                >
                  {catalog.recipes
                    .find((v) => v.id === n.recipeId)
                    ?.machineIds.map((id) => (
                      <option key={id} value={id}>
                        {catalog.machines.find((m) => m.id === id)?.name}
                      </option>
                    ))}
                </ChoiceSelect>
              </Field>
              <Field label="Uniform clock speed (%)">
                <Numeric
                  value={n.clock}
                  min={machine?.minClock ?? 1}
                  max={machine?.maxClock ?? 250}
                  change={(clock) => patch({ clock })}
                />
              </Field>
              <Field label="Somersloops per machine">
                <ChoiceSelect
                  className={selectClass}
                  value={n.somersloops}
                  onChange={(e) => patch({ somersloops: Number(e.target.value) })}
                >
                  {Array.from({ length: (machine?.boostSlots ?? 0) + 1 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </ChoiceSelect>
              </Field>
              {r && (
                <div className="space-y-1 rounded-md bg-muted p-3 text-xs">
                  <p>
                    {r.machines} machines · {number(r.utilization * 100)}% utilization
                  </p>
                  <p>{r.somersloops} Somersloops installed</p>
                  <p>
                    {number(r.powerMin)}–{number(r.powerMax)} MW planned
                  </p>
                  <p>{number(r.installedPowerMax)} MW installed peak</p>
                  <p className="text-muted-foreground">
                    Spare capacity remains at the selected clock speed. Power excludes idle
                    consumption.
                  </p>
                </div>
              )}
            </>
          )}

          {n.kind === 'link' && (
            <div className="space-y-2 text-xs">
              <p>
                One shared physical factory:{' '}
                {workspace.diagrams.find((d) => d.id === n.linkedDiagramId)?.document.name}
              </p>
              {workspace.diagrams
                .find((d) => d.id === n.linkedDiagramId)
                ?.document.nodes.filter((v) => ['input', 'output'].includes(v.kind))
                .map((v) => (
                  <p key={v.id}>
                    {v.kind === 'input' ? 'Requires' : 'Exports'}{' '}
                    {catalog.items.find((i) => i.id === v.itemId)?.name}:{' '}
                    {number(
                      v.kind === 'output'
                        ? v.rate
                        : (workspace.calculations
                            .find((c) => c.diagramId === n.linkedDiagramId)
                            ?.nodes.find((r) => r.nodeId === v.id)
                            ?.outputs.reduce((s, f) => s + f.rate, 0) ?? 0)
                    )}
                    /min
                  </p>
                ))}
            </div>
          )}
        </>
      )}
      {!edge && (!n || n.kind === 'group') && (
        <>
          {n?.kind === 'group' && r && (
            <div className="space-y-2 rounded-md bg-muted p-3 text-xs">
              <p>
                {r.machines} machines · {number(r.powerMax)} MW planned
              </p>
              {[
                ['Inputs', r.inputs],
                ['Outputs', r.outputs],
              ].map(([label, values]) => (
                <div key={String(label)}>
                  <p className="font-medium">{String(label)}</p>
                  {(values as typeof r.inputs)
                    .filter((f) => f.rate > 0)
                    .map((f) => (
                      <p key={f.itemId} className="mt-1 text-muted-foreground">
                        {catalog.items.find((i) => i.id === f.itemId)?.name}: {number(f.rate)}/min
                      </p>
                    ))}
                </div>
              ))}
            </div>
          )}
          {(['beltTier', 'pipeTier'] as const).map((field) => (
            <Field key={field} label={field === 'beltTier' ? 'Internal belts' : 'Internal pipes'}>
              <ChoiceSelect
                className={selectClass}
                value={policy[field]}
                onChange={(e) => changePolicy({ [field]: Number(e.target.value) })}
              >
                <option value={0}>Inherit (Mk.{effective[field]})</option>
                {catalog[field === 'beltTier' ? 'belts' : 'pipes'].map((rate, i) => (
                  <option key={i} value={i + 1}>
                    Mk.{i + 1} · {rate}/min
                  </option>
                ))}
              </ChoiceSelect>
            </Field>
          ))}
          <div className="border-t pt-4">
            <h3 className="text-xs font-semibold">Recipe preferences</h3>
          </div>
          {effective.recipes.map((choice) => (
            <div key={choice.itemId} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{catalog.items.find((i) => i.id === choice.itemId)?.name}</span>
                {policy.recipes.some((v) => v.itemId === choice.itemId) ? (
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      changePolicy(
                        { recipes: policy.recipes.filter((v) => v.itemId !== choice.itemId) },
                        true
                      )
                    }
                  >
                    Reset
                  </button>
                ) : (
                  <span className="text-muted-foreground">Inherited</span>
                )}
              </div>
              <ChoiceSelect
                className={selectClass}
                value={choice.recipeId}
                onChange={(e) =>
                  changePolicy(
                    {
                      recipes: [
                        ...policy.recipes.filter((v) => v.itemId !== choice.itemId),
                        { itemId: choice.itemId, recipeId: e.target.value },
                      ],
                    },
                    true
                  )
                }
              >
                {catalog.recipes
                  .filter((v) => v.products.some((p) => p.itemId === choice.itemId))
                  .map((v) => (
                    <option key={v.id} value={v.id} disabled={v.unavailable}>
                      {v.name}
                      {catalog.unlocks.find((u) => u.recipeId === v.id)?.unlocked === false
                        ? ' · Locked'
                        : ''}
                    </option>
                  ))}
              </ChoiceSelect>
            </div>
          ))}
          <MaterialSelect
            items={catalog.items.filter((i) =>
              catalog.recipes.some(
                (r) => !r.unavailable && r.products.some((p) => p.itemId === i.id)
              )
            )}
            value={product}
            onChange={setProduct}
            placeholder="Add recipe preference…"
          />
          {product && (
            <Field label="Recipe">
              <ChoiceSelect
                className={selectClass}
                value=""
                onChange={(e) => {
                  changePolicy(
                    {
                      recipes: [
                        ...policy.recipes.filter((v) => v.itemId !== product),
                        { itemId: product, recipeId: e.target.value },
                      ],
                    },
                    true
                  );
                  setProduct('');
                }}
              >
                <option value="">Select recipe…</option>
                {catalog.recipes
                  .filter((r) => r.products.some((p) => p.itemId === product))
                  .map((r) => (
                    <option key={r.id} value={r.id} disabled={r.unavailable}>
                      {r.name}
                      {catalog.unlocks.find((u) => u.recipeId === r.id)?.unlocked === false
                        ? ' · Locked'
                        : ''}
                    </option>
                  ))}
              </ChoiceSelect>
            </Field>
          )}
        </>
      )}
      {edge && (
        <>
          <p>{catalog.items.find((i) => i.id === edge.itemId)?.name}</p>
          {calculation?.connections
            .filter((r) => r.connectionId === edge.id)
            .map((r) => (
              <div key={r.connectionId} className="rounded-md bg-muted p-3 text-xs space-y-1">
                <p>
                  {number(r.rate)}/min · Mk.{r.tier} · {r.capacity}/min per line
                </p>
                <p>{r.requiredLines} parallel lines required</p>
                <p>Policy: {doc.nodes.find((n) => n.id === r.scopeId)?.name || 'Main diagram'}</p>
              </div>
            ))}
          <Field label="Installed parallel lines (empty = unrestricted)">
            <Input
              type="number"
              min={0}
              step={1}
              value={edge.availableLines ?? ''}
              onChange={(e) =>
                edit({
                  ...doc,
                  connections: doc.connections.map((v) =>
                    v.id === edge.id
                      ? {
                          ...v,
                          availableLines:
                            e.target.value === ''
                              ? null
                              : Math.max(0, Math.floor(Number(e.target.value))),
                        }
                      : v
                  ),
                })
              }
            />
          </Field>
        </>
      )}
      {diagnostics.map((d, i) => (
        <p
          key={i}
          className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
        >
          {d.message}
          {d.rate > 0 ? ` · ${number(d.rate)}/min` : ''}
        </p>
      ))}
      {(n || edge) && (
        <Button variant="destructive" size="sm" onClick={remove}>
          Remove {edge ? 'connection' : n?.kind === 'group' ? 'section and children' : 'node'}
        </Button>
      )}
    </div>
  );
}
