import { Checkbox } from '@/components/ui/checkbox';
import { buildable, changeMaterial } from './model';
import { ChoiceSelect, MaterialSelect, MaterialIcon } from './pickers';
import { ConstructionStatus } from './construction-status';
import { NameInput } from './name-input';
import { memo, useState } from 'react';
import { ArrowRight, ChevronRight, Plus, X, Trash2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
    <label className="block space-y-1.5 text-xs text-foreground">
      <span className="text-muted-foreground">{label}</span>
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

type MaterialFlowRow = { id: string; itemId: string; rate?: number; disabled?: boolean };

function MaterialFlowSections({
  catalog,
  inputs,
  outputs,
  label,
  toggleOutput,
}: {
  catalog: PlannerWorkspace['catalog'];
  inputs: MaterialFlowRow[];
  outputs: MaterialFlowRow[];
  label: string;
  toggleOutput?: (itemId: string) => void;
}) {
  return (
    <div className="space-y-5 border-t pt-4">
      {(['inputs', 'outputs'] as const).map((direction) => {
        const incoming = direction === 'inputs';
        const materials = incoming ? inputs : outputs;
        return (
          <section key={direction} aria-label={`${label} ${direction}`} className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold">
              {incoming && <ArrowRight className="size-4" />}
              {incoming ? 'Inputs' : 'Outputs'}
              {!incoming && <ArrowRight className="size-4" />}
            </h3>
            {materials.length ? (
              <dl className="space-y-3">
                {materials.map((flow) => {
                  const item = catalog.items.find((item) => item.id === flow.itemId);
                  if (!incoming && toggleOutput) {
                    return (
                      <div key={flow.id}>
                        <dt className="sr-only">{item?.name ?? flow.itemId}</dt>
                        <dd>
                          <button
                            type="button"
                            aria-label={`${item?.name ?? flow.itemId} output`}
                            aria-pressed={!flow.disabled}
                            onClick={() => toggleOutput(flow.itemId)}
                            className={`flex w-full items-center justify-between gap-3 rounded-md p-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${flow.disabled ? 'text-muted-foreground opacity-40 grayscale' : ''}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <MaterialIcon name={item?.name ?? flow.itemId} className="size-6" />
                              <span>{item?.name ?? flow.itemId}</span>
                            </span>
                            <span className="shrink-0 text-right text-muted-foreground">
                              {!flow.disabled && (
                                <span className="block tabular-nums">
                                  {flow.rate === undefined
                                    ? '—'
                                    : `${number(flow.rate, 1)} ${item?.form === 'solid' ? 'items' : 'm³'}/min`}
                                </span>
                              )}
                            </span>
                          </button>
                        </dd>
                      </div>
                    );
                  }
                  return (
                    <div key={flow.id} className="flex items-center justify-between gap-3 text-xs">
                      <dt className="flex min-w-0 items-center gap-2">
                        <MaterialIcon name={item?.name ?? flow.itemId} className="size-6" />
                        <span>{item?.name ?? flow.itemId}</span>
                      </dt>
                      <dd className="shrink-0 tabular-nums text-muted-foreground">
                        {flow.rate === undefined
                          ? '—'
                          : `${number(flow.rate, 1)} ${item?.form === 'solid' ? 'items' : 'm³'}/min`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                {incoming ? 'No inputs required.' : 'No outputs exposed.'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function InspectorComponent({
  doc,
  selected,
  workspace,
  calculation,
  stale = false,
  onNamePendingChange,
  edit,
  remove,
}: {
  doc: PlannerDocument;
  selected: string;
  workspace: PlannerWorkspace;
  calculation?: PlannerCalculation;
  stale?: boolean;
  onNamePendingChange: (pending: boolean) => void;
  edit: (d: PlannerDocument, expand?: boolean) => void;
  remove: () => void;
}) {
  const [product, setProduct] = useState('');
  const [surplusEditors, setSurplusEditors] = useState<string[]>([]);
  const n = doc.nodes.find((n) => n.id === selected);
  const edge = doc.connections.find((e) => e.id === selected);
  const r = calculation?.nodes.find((r) => r.nodeId === selected);
  const { catalog } = workspace;
  const edgeItem = catalog.items.find((item) => item.id === edge?.itemId);
  const edgeFlow = calculation?.connections.find((flow) => flow.connectionId === edge?.id);
  const patch = (p: Partial<PlannerNode>, expand = false) =>
    edit(
      { ...doc, nodes: doc.nodes.map((v) => (v.id === selected ? { ...v, ...p } : v)) },
      expand ||
        ['rate', 'kind', 'inputRateMode', 'outputRateMode', 'exposed', 'itemId'].some((k) => k in p)
    );
  const scope = n?.kind === 'group' ? n.id : '';
  const policy = n?.kind === 'group' ? n.settings : doc.settings;
  const effective = inherited(doc, scope);
  const changePolicy = (p: Partial<typeof policy>, expand = false) =>
    n
      ? patch({ settings: { ...policy, ...p } }, expand)
      : edit({ ...doc, settings: { ...policy, ...p } }, expand);
  const sections = n
    ? doc.nodes.filter(
        (v) => v.kind === 'group' && v.id !== n.id && !ancestors(doc, v.id).includes(n.id)
      )
    : [];
  const productNode = n && n.kind !== 'group' && n.kind !== 'link';
  const recipe = catalog.recipes.find((v) => v.id === n?.recipeId);
  const machine = catalog.machines.find((m) => m.id === n?.machineId);
  const linkedDiagram = workspace.diagrams.find((d) => d.id === n?.linkedDiagramId);
  const linkedCalculation = workspace.calculations.find((c) => c.diagramId === linkedDiagram?.id);
  const linkedFlows = (direction: 'inputs' | 'outputs'): MaterialFlowRow[] =>
    (linkedDiagram?.document.nodes ?? [])
      .filter((node) =>
        direction === 'inputs' ? node.kind === 'input' : node.kind === 'output' && node.exposed
      )
      .map((node) => ({
        id: node.id,
        itemId: node.itemId,
        rate:
          (node.kind === 'output' && node.outputRateMode !== 'demand') ||
          (node.kind === 'input' && node.inputRateMode === 'fixed')
            ? node.rate
            : !stale &&
                linkedCalculation?.resolved &&
                linkedCalculation.calculationKey === linkedDiagram?.calculationKey
              ? linkedCalculation.nodes
                  .find((r) => r.nodeId === node.id)
                  ?.outputs.reduce((sum, flow) => sum + flow.rate, 0)
              : undefined,
      }));
  const recipeFlows = (direction: 'inputs' | 'outputs'): MaterialFlowRow[] =>
    (direction === 'inputs' ? (recipe?.ingredients ?? []) : (recipe?.products ?? [])).map(
      (amount) => ({
        id: amount.itemId,
        itemId: amount.itemId,
        disabled: direction === 'outputs' && n?.disabledOutputs?.includes(amount.itemId),
        rate:
          !stale && calculation?.resolved
            ? r?.[direction].find((flow) => flow.itemId === amount.itemId)?.rate
            : undefined,
      })
    );
  const recipeChoices = (itemId: string) => {
    const recipes = catalog.recipes.filter((r) => r.products.some((p) => p.itemId === itemId));
    if (scope) return recipes;
    const item = catalog.items.find((i) => i.id === itemId);
    const standard = recipes.filter(
      (r) =>
        !r.alternate && !r.id.startsWith('Recipe_Unpackage') && r.products[0]?.itemId === itemId
    );
    const base =
      standard.find((r) => r.name.toLowerCase() === item?.name.toLowerCase()) ??
      (standard.length === 1 ? standard[0] : undefined);
    return recipes.filter((r) => r.id !== base?.id);
  };
  const surplusChoices = (itemId: string, preferred: string) =>
    catalog.recipes.filter(
      (r) => r.id !== preferred && r.products.some((p) => p.itemId === itemId)
    );
  const resetRecipeChoice = (itemId: string) =>
    changePolicy({ recipes: policy.recipes.filter((choice) => choice.itemId !== itemId) }, true);
  const renderInheritedRecipe = (itemId: string) => {
    const parentChoice = inherited(doc, n?.parentId ?? '').recipes.find(
      (choice) => choice.itemId === itemId
    );
    const parentRecipe = catalog.recipes.find((recipe) => recipe.id === parentChoice?.recipeId);
    return (
      <span className="min-w-0 truncate">
        Inherit{' '}
        <span className="text-muted-foreground">
          ({parentRecipe?.name.replace(/^Alternate:\s*/i, '') ?? 'Default recipe'})
        </span>
      </span>
    );
  };
  const updateRecipeChoice = (choice: (typeof effective.recipes)[number]) =>
    changePolicy(
      { recipes: [...policy.recipes.filter((v) => v.itemId !== choice.itemId), choice] },
      true
    );
  const renderTransportOption = (field: 'beltTier' | 'pipeTier', value: string) => {
    const inheritedTier = n?.kind === 'group' ? inherited(doc, n.parentId)[field] : 1;
    const tier = Number(value) || inheritedTier;
    const transport = `${field === 'beltTier' ? 'Conveyor Belt' : 'Pipeline'} Mk.${tier}`;
    const speed = catalog[field === 'beltTier' ? 'belts' : 'pipes'][tier - 1];
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <MaterialIcon key={transport} name={transport} className="size-5" />
        <span>{Number(value) ? `Mk.${tier}` : `Inherit (Mk.${tier})`}</span>
        <span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">
          {number(speed)}/min
        </span>
      </span>
    );
  };
  const renderRecipeOption = (id: string) => {
    const recipe = catalog.recipes.find((r) => r.id === id);
    if (!recipe) return 'Select recipe…';
    return (
      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="truncate">
          {recipe.name.replace(/^Alternate:\s*/i, '')}
          {catalog.unlocks.find((u) => u.recipeId === id)?.unlocked === false && (
            <span className="text-muted-foreground"> · Locked</span>
          )}
        </span>
        {recipe.alternate && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            Alternate
          </Badge>
        )}
      </span>
    );
  };
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 text-sm">
      <div className="space-y-4">
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
        </div>
        {!edge && !productNode && (
          <Field label="Name">
            <NameInput
              onPendingChange={onNamePendingChange}
              key={n?.id ?? 'diagram'}
              value={n?.name ?? doc.name}
              onChange={(name) => (n ? patch({ name }) : edit({ ...doc, name }))}
            />
          </Field>
        )}
        {n && ['output', 'input', 'supply'].includes(n.kind) && (
          <MaterialSelect
            items={catalog.items}
            value={n.itemId}
            placeholder="Choose item…"
            onChange={(itemId) => {
              if (itemId !== n.itemId) edit(changeMaterial(doc, n.id, itemId), true);
            }}
          />
        )}
        {n && (
          <>
            {buildable(n) && (
              <Field label="Construction status">
                <ChoiceSelect
                  className={selectClass}
                  value={n.status}
                  renderOption={(value) => <ConstructionStatus value={value} />}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  {['planned', 'building', 'built'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </ChoiceSelect>
              </Field>
            )}
            {n.kind === 'group' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  edit({
                    ...doc,
                    nodes: doc.nodes.map((v) =>
                      ancestors(doc, v.id).includes(n.id) && buildable(v)
                        ? { ...v, status: n.status }
                        : v
                    ),
                  })
                }
              >
                Apply status to all children
              </Button>
            )}
            {n.kind === 'input' && (
              <ChoiceSelect
                aria-label="Required input rate"
                value={n.inputRateMode || 'calculated'}
                onChange={(e) => patch({ inputRateMode: e.target.value, rate: 0 })}
              >
                <option value="calculated">Calculated from outputs</option>
                <option value="fixed">Fixed rate from parent</option>
              </ChoiceSelect>
            )}
            {n.kind === 'output' && (
              <>
                <Field label="Production mode">
                  <ChoiceSelect
                    value={n.outputRateMode || 'fixed'}
                    onChange={(e) =>
                      patch({
                        outputRateMode: e.target.value,
                        ...(e.target.value === 'demand'
                          ? { exposed: true, rate: 0 }
                          : { rate: r?.outputs.reduce((sum, f) => sum + f.rate, 0) || 1 }),
                      })
                    }
                  >
                    <option value="fixed">Fixed output</option>
                    <option value="demand">Follow demand</option>
                  </ChoiceSelect>
                </Field>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={n.exposed}
                    onCheckedChange={(checked) => {
                      const exposed = checked === true;
                      edit(
                        {
                          ...doc,
                          nodes: doc.nodes.map((v) =>
                            v.id === n.id
                              ? {
                                  ...v,
                                  exposed,
                                  ...(!exposed && v.outputRateMode === 'demand'
                                    ? {
                                        outputRateMode: 'fixed',
                                        rate: r?.outputs.reduce((sum, f) => sum + f.rate, 0) || 1,
                                      }
                                    : {}),
                                }
                              : v
                          ),
                          connections: exposed
                            ? doc.connections
                            : doc.connections.filter((c) => c.source !== n.id),
                        },
                        true
                      );
                    }}
                  />
                  Expose to parent
                </label>
                {n.outputRateMode === 'demand' && (
                  <p className="text-xs text-muted-foreground">
                    Production follows the combined demand of connected consumers.
                  </p>
                )}
                {n.exposed && r && (
                  <p className="text-xs text-muted-foreground">
                    {number(r.exportRate)}/min export demand · {number(r.surplusRate)}/min surplus
                  </p>
                )}
              </>
            )}
            {((n.kind === 'output' && n.outputRateMode !== 'demand') ||
              n.kind === 'supply' ||
              (n.kind === 'input' && n.inputRateMode === 'fixed')) && (
              <Field
                label={
                  n.kind === 'output'
                    ? 'Requested output / minute'
                    : n.kind === 'input'
                      ? 'Required from parent / minute'
                      : 'Available supply / minute'
                }
              >
                {n.kind === 'input' ? (
                  <>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={n.rate || ''}
                      aria-invalid={n.rate <= 0}
                      onChange={(e) =>
                        patch({ rate: e.target.value === '' ? 0 : Number(e.target.value) })
                      }
                    />
                    {n.rate <= 0 && (
                      <span className="text-destructive">Enter a rate greater than 0.</span>
                    )}
                  </>
                ) : (
                  <Numeric value={n.rate} change={(rate) => patch({ rate })} />
                )}
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
                <Checkbox
                  checked={n.fixedSupply}
                  onCheckedChange={(checked) => patch({ fixedSupply: checked === true })}
                />
                Fixed incoming rate (report surplus)
              </label>
            )}
            {n.kind === 'link' && (
              <MaterialFlowSections
                catalog={catalog}
                inputs={linkedFlows('inputs')}
                outputs={linkedFlows('outputs')}
                label="Factory"
              />
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
                  value={scope ? policy[field] : effective[field]}
                  renderOption={(value) => renderTransportOption(field, value)}
                  onChange={(e) => changePolicy({ [field]: Number(e.target.value) })}
                >
                  {scope && <option value={0}>Inherit</option>}
                  {catalog[field === 'beltTier' ? 'belts' : 'pipes'].map((rate, i) => (
                    <option key={i} value={i + 1}>
                      Mk.{i + 1} {rate}/min
                    </option>
                  ))}
                </ChoiceSelect>
              </Field>
            ))}
            <div className="border-t pt-4">
              <h3 className="text-xs font-semibold">Recipe preferences</h3>
            </div>
            {effective.recipes.map((choice) => (
              <div key={choice.itemId} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MaterialIcon
                      name={
                        catalog.items.find((i) => i.id === choice.itemId)?.name ?? choice.itemId
                      }
                      className="size-5"
                    />
                    {catalog.items.find((i) => i.id === choice.itemId)?.name}
                  </span>
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
                  ) : null}
                </div>
                {(choice.surplusRecipeId ||
                  surplusEditors.includes(`${scope}/${choice.itemId}`)) && (
                  <p className="text-xs text-muted-foreground">Preferred recipe</p>
                )}
                {!scope && !recipeChoices(choice.itemId).some((r) => r.id === choice.recipeId) ? (
                  <p className="text-xs text-muted-foreground">
                    {catalog.recipes.find((r) => r.id === choice.recipeId)?.name}
                  </p>
                ) : (
                  <ChoiceSelect
                    className={selectClass}
                    aria-label={`Preferred recipe for ${catalog.items.find((i) => i.id === choice.itemId)?.name}`}
                    value={
                      scope && !policy.recipes.some((v) => v.itemId === choice.itemId)
                        ? '__inherit'
                        : choice.recipeId
                    }
                    renderOption={(id) =>
                      id === '__inherit'
                        ? renderInheritedRecipe(choice.itemId)
                        : renderRecipeOption(id)
                    }
                    onChange={(e) =>
                      e.target.value === '__inherit'
                        ? resetRecipeChoice(choice.itemId)
                        : changePolicy(
                            {
                              recipes: [
                                ...policy.recipes.filter((v) => v.itemId !== choice.itemId),
                                {
                                  ...choice,
                                  recipeId: e.target.value,
                                  surplusRecipeId:
                                    choice.surplusRecipeId === e.target.value
                                      ? ''
                                      : choice.surplusRecipeId,
                                },
                              ],
                            },
                            true
                          )
                    }
                  >
                    {scope && <option value="__inherit">Inherit</option>}
                    {recipeChoices(choice.itemId).map((v) => (
                      <option key={v.id} value={v.id} disabled={v.unavailable}>
                        {v.name}
                        {catalog.unlocks.find((u) => u.recipeId === v.id)?.unlocked === false
                          ? ' · Locked'
                          : ''}
                      </option>
                    ))}
                  </ChoiceSelect>
                )}
                {choice.surplusRecipeId || surplusEditors.includes(`${scope}/${choice.itemId}`) ? (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Use surplus</span>
                      <button
                        className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"
                        aria-label={`Remove surplus recipe for ${catalog.items.find((i) => i.id === choice.itemId)?.name}`}
                        onClick={() => {
                          setSurplusEditors((items) =>
                            items.filter((v) => v !== `${scope}/${choice.itemId}`)
                          );
                          if (choice.surplusRecipeId)
                            updateRecipeChoice({ ...choice, surplusRecipeId: '' });
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <ChoiceSelect
                      className={selectClass}
                      aria-label={`Surplus recipe for ${catalog.items.find((i) => i.id === choice.itemId)?.name}`}
                      value={choice.surplusRecipeId || ''}
                      renderOption={renderRecipeOption}
                      onChange={(e) =>
                        updateRecipeChoice({ ...choice, surplusRecipeId: e.target.value })
                      }
                    >
                      <option value="">Select surplus recipe…</option>
                      {surplusChoices(choice.itemId, choice.recipeId).map((r) => (
                        <option key={r.id} value={r.id} disabled={r.unavailable}>
                          {r.name}
                        </option>
                      ))}
                    </ChoiceSelect>
                    {choice.surplusRecipeId && (
                      <p className="text-xs text-muted-foreground">
                        Uses available surplus materials.
                      </p>
                    )}
                  </div>
                ) : (
                  surplusChoices(choice.itemId, choice.recipeId).some((r) => !r.unavailable) && (
                    <button
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setSurplusEditors((items) => [...items, `${scope}/${choice.itemId}`])
                      }
                    >
                      <Plus className="size-3.5" />
                      Add surplus recipe…
                    </button>
                  )
                )}
              </div>
            ))}
            <MaterialSelect
              items={catalog.items.filter(
                (i) =>
                  !effective.recipes.some((choice) => choice.itemId === i.id) &&
                  catalog.recipes.filter(
                    (r) => !r.unavailable && r.products.some((p) => p.itemId === i.id)
                  ).length > 1 &&
                  recipeChoices(i.id).some((r) => !r.unavailable)
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
                  renderOption={renderRecipeOption}
                  onChange={(e) => {
                    changePolicy(
                      {
                        recipes: [
                          ...policy.recipes.filter((v) => v.itemId !== product),
                          { itemId: product, recipeId: e.target.value, surplusRecipeId: '' },
                        ],
                      },
                      true
                    );
                    setProduct('');
                  }}
                >
                  <option value="">Select recipe…</option>
                  {recipeChoices(product).map((r) => (
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
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <MaterialIcon name={edgeItem?.name ?? edge.itemId} className="size-6" />
                <span>{edgeItem?.name ?? edge.itemId}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {!stale && calculation?.resolved && edgeFlow
                  ? `${number(edgeFlow.rate, 1)} ${edgeItem?.form === 'solid' ? 'items' : 'm³'}/min`
                  : '—'}
              </span>
            </div>
            {calculation?.connections
              .filter((r) => r.connectionId === edge.id)
              .map((r) => {
                const transport = `${edgeItem?.form === 'solid' ? 'Conveyor Belt' : 'Pipeline'} Mk.${r.tier}`;
                return (
                  <div key={r.connectionId} className="flex items-center gap-2 font-medium">
                    <MaterialIcon key={transport} name={transport} className="size-5" />
                    <span>
                      {r.requiredLines} × {transport}
                    </span>
                  </div>
                );
              })}
            {calculation?.diagnostics
              .filter((d) => d.connectionId === edge.id)
              .map((d, i) => (
                <p key={i} className="text-xs text-destructive">
                  {d.message}
                  {d.code === 'transport_shortage' && edge.availableLines != null
                    ? ` (${edge.availableLines} installed)`
                    : ''}
                </p>
              ))}
            {edge.availableLines != null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  edit({
                    ...doc,
                    connections: doc.connections.map((e) =>
                      e.id === edge.id ? { ...e, availableLines: null } : e
                    ),
                  })
                }
              >
                Clear capacity limit
              </Button>
            )}
          </>
        )}
        {n?.kind === 'production' && recipe && (
          <MaterialFlowSections
            catalog={catalog}
            inputs={recipeFlows('inputs')}
            outputs={recipeFlows('outputs')}
            label="Recipe"
            toggleOutput={(itemId) =>
              patch(
                {
                  disabledOutputs: n.disabledOutputs?.includes(itemId)
                    ? n.disabledOutputs.filter((id) => id !== itemId)
                    : [...(n.disabledOutputs ?? []), itemId].sort(),
                },
                true
              )
            }
          />
        )}

        {n && ((!n.generated && sections.length > 0) || n.kind === 'production') && (
          <Collapsible key={n.id}>
            <CollapsibleTrigger className="group flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
              Advanced
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {!n.generated && sections.length > 0 && (
                <Field label="Containing section">
                  <ChoiceSelect
                    className={selectClass}
                    value={n.parentId}
                    onChange={(e) => edit(reparent(doc, [n.id], e.target.value), true)}
                  >
                    <option value="">Main diagram</option>
                    {sections.map((v) => (
                      <option value={v.id} key={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </ChoiceSelect>
                </Field>
              )}
              {n.kind === 'production' && (
                <>
                  <div className="space-y-1 text-sm">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Recipe
                    </p>
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 truncate">
                        {recipe?.name.replace(/^Alternate:\s*/i, '')}
                      </p>
                      {recipe?.alternate && (
                        <Badge variant="secondary" className="shrink-0">
                          Alternate
                        </Badge>
                      )}
                    </div>
                  </div>
                  {(recipe?.machineIds.length ?? 0) > 1 && (
                    <Field label="Machine">
                      <ChoiceSelect
                        className={selectClass}
                        value={n.machineId}
                        onChange={(e) => patch({ machineId: e.target.value, somersloops: 0 })}
                      >
                        {recipe?.machineIds.map((id) => (
                          <option key={id} value={id}>
                            {catalog.machines.find((m) => m.id === id)?.name}
                          </option>
                        ))}
                      </ChoiceSelect>
                    </Field>
                  )}
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
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      {((n && !n.generated) || (edge && !edge.generated)) && (
        <div className="mt-auto flex justify-end pt-4">
          <Button variant="destructive" size="sm" onClick={remove}>
            <Trash2 size={14} />
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

export const Inspector = memo(InspectorComponent);
