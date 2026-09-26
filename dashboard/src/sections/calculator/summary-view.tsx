import { memo, useMemo, useState } from 'react';
import { Boxes, Factory, Layers, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableFooter,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChoiceSelect, MaterialIcon } from './pickers';
import { number } from './model';
import {
  summarizeFactory,
  summaryScopes,
  type MaterialSummary,
  type BuildingSummary,
} from './summary';
import type { PlannerDiagram, PlannerWorkspace } from '@/services/plannerApi';

/** Full-page material and construction totals with persistent scope controls. */
function SummaryViewComponent({
  workspace,
  diagram,
  stale,
}: {
  workspace: PlannerWorkspace;
  diagram: PlannerDiagram;
  stale: boolean;
}) {
  const [kind, setKind] = useState('material');
  const [scopeId, setScopeId] = useState('all');
  const scopes = useMemo(
    () => summaryScopes(diagram, workspace.diagrams),
    [diagram, workspace.diagrams]
  );
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0];
  const summary = useMemo(
    () => summarizeFactory(workspace, diagram, scope),
    [workspace, diagram, scope]
  );
  const item = (id: string) => workspace.catalog.items.find((i) => i.id === id);
  const rate = (id: string, value: number) =>
    `${number(value, 1)} ${item(id)?.form === 'solid' ? 'items' : 'm³'}/min`;
  const totalCosts = new Map<string, number>();
  const totals: BuildingSummary = {
    machineId: '',
    count: 0,
    powerMin: 0,
    powerMax: 0,
    peak: 0,
    powerKnown: true,
    costKnown: true,
    cost: [],
  };
  for (const row of summary.buildings) {
    totals.count += row.count;
    totals.powerMin += row.powerMin;
    totals.powerMax += row.powerMax;
    totals.peak += row.peak;
    totals.powerKnown &&= row.powerKnown;
    totals.costKnown &&= row.costKnown;
    for (const cost of row.cost)
      totalCosts.set(cost.itemId, (totalCosts.get(cost.itemId) ?? 0) + cost.amount);
  }
  totals.cost = [...totalCosts]
    .map(([itemId, amount]) => ({ itemId, amount }))
    .sort((a, b) =>
      (item(a.itemId)?.name ?? a.itemId).localeCompare(item(b.itemId)?.name ?? b.itemId)
    );
  const buildingValues = (row: BuildingSummary) => (
    <>
      <TableCell className="text-right tabular-nums">{number(row.count)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.powerKnown
          ? `${row.powerMax - row.powerMin > 0.01 ? `${number(row.powerMin, 1)}–` : ''}${number(row.powerMax, 1)} MW`
          : 'Unknown'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.powerKnown ? `${number(row.peak, 1)} MW` : 'Unknown'}
      </TableCell>
      <TableCell className="px-4">
        {row.costKnown ? (
          <div className="flex min-w-52 flex-wrap gap-x-4 gap-y-2">
            {row.cost.map((cost) => (
              <span key={cost.itemId} className="inline-flex items-center gap-1.5">
                <MaterialIcon name={item(cost.itemId)?.name ?? cost.itemId} className="size-5" />
                <span className="tabular-nums">{number(cost.amount)} ×</span>{' '}
                {item(cost.itemId)?.name ?? cost.itemId}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">Cost unavailable</span>
        )}
      </TableCell>
    </>
  );
  const materialTable = (rows: MaterialSummary[], output: boolean) => (
    <section className="min-w-0 space-y-3" aria-label={output ? 'Outputs' : 'Inputs'}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {output ? <ArrowUpFromLine className="size-4" /> : <ArrowDownToLine className="size-4" />}
        {output ? 'Outputs' : 'Inputs'}
      </h2>
      <div className="overflow-hidden rounded-lg border">
        <Table aria-label={output ? 'Output materials' : 'Input materials'}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Material</TableHead>
              <TableHead className="text-right">{output ? 'Output' : 'Required'}</TableHead>
              {output && <TableHead className="pr-4 text-right">Residual</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.itemId}>
                <TableCell className="pl-4">
                  <span className="flex items-center gap-2 whitespace-normal">
                    <MaterialIcon name={item(row.itemId)?.name ?? row.itemId} className="size-7" />
                    {item(row.itemId)?.name ?? row.itemId}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.rate > 0 ? rate(row.itemId, row.rate) : '—'}
                </TableCell>
                {output && (
                  <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">
                    {row.residual > 0 ? rate(row.itemId, row.residual) : '—'}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell
                  colSpan={output ? 3 : 2}
                  className="p-6 text-center text-muted-foreground"
                >
                  {output
                    ? 'No outputs or residuals in this scope.'
                    : 'No external inputs required in this scope.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse sm:flex-row" data-testid="factory-summary">
      <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 lg:p-6">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold">
            {kind === 'material' ? 'Material' : 'Buildings'} summary
          </h1>
          {scopes.length > 2 && <span className="text-sm text-muted-foreground">{scope.name}</span>}
        </div>
        {stale || !summary.complete ? (
          <p role="status" className="rounded-lg border p-6 text-sm text-muted-foreground">
            {stale
              ? 'Waiting for current calculations…'
              : 'Summary unavailable until this scope has a resolved calculation.'}
          </p>
        ) : kind === 'material' ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {materialTable(summary.inputs, false)}
            {materialTable(summary.outputs, true)}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {number(totals.count)} buildings required. Power reflects planned utilization; peak
              assumes all installed machines run.
            </p>
            <div className="overflow-hidden rounded-lg border">
              <Table aria-label="Required buildings">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Building</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Power</TableHead>
                    <TableHead className="text-right">Peak power</TableHead>
                    <TableHead className="px-4">Total build materials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.buildings.map((row) => {
                    const name =
                      workspace.catalog.machines.find((m) => m.id === row.machineId)?.name ??
                      row.machineId;
                    return (
                      <TableRow key={row.machineId}>
                        <TableCell className="pl-4">
                          <span className="flex items-center gap-2">
                            <MaterialIcon name={name} />
                            {name}
                          </span>
                        </TableCell>
                        {buildingValues(row)}
                      </TableRow>
                    );
                  })}
                  {!summary.buildings.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-6 text-center text-muted-foreground">
                        No buildings required in this scope.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                {summary.buildings.length > 0 && (
                  <TableFooter className="border-y-2">
                    <TableRow>
                      <TableHead scope="row" className="pl-4 font-semibold">
                        Total
                      </TableHead>
                      {buildingValues(totals)}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </>
        )}
      </main>
      <aside
        aria-label="Summary options"
        className="shrink-0 space-y-5 border-b p-4 sm:w-64 sm:overflow-auto sm:border-b-0 sm:border-l"
      >
        <ChoiceSelect
          aria-label="Summary type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          renderOption={(value) => (
            <span className="flex items-center gap-2">
              {value === 'material' ? <Boxes className="size-4" /> : <Factory className="size-4" />}
              {value === 'material' ? 'Material' : 'Buildings'}
            </span>
          )}
        >
          <option value="material">Material</option>
          <option value="buildings">Buildings</option>
        </ChoiceSelect>
        {scopes.length > 2 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Factory</p>
            <ChoiceSelect
              aria-label="Summary factory"
              value={scope.id}
              onChange={(e) => setScopeId(e.target.value)}
              renderOption={(id) => (
                <span className="flex min-w-0 items-center gap-2">
                  <Layers className="size-4 shrink-0" />
                  <span className="truncate">{scopes.find((s) => s.id === id)?.name}</span>
                </span>
              )}
            >
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </ChoiceSelect>
          </div>
        )}
      </aside>
    </div>
  );
}

export const SummaryView = memo(SummaryViewComponent);
