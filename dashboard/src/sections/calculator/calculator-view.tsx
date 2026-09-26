import { fDateTime } from '@/utils/format-time';
import { Checkbox } from '@/components/ui/checkbox';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import {
  ArrowLeft,
  Plus,
  Undo2,
  Redo2,
  Network,
  Layers,
  Settings2,
  AlertTriangle,
  X,
  Calculator,
  Target,
  PackagePlus,
  ArrowDownToLine,
  Link2,
  Trash2,
  TableProperties,
  Search,
  EllipsisVertical,
  Copy,
  Download,
  Pencil,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/contexts/sessions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  plannerApi,
  type PlannerWorkspace,
  type PlannerDiagram,
  type PlannerDocument,
} from '@/services/plannerApi';
import {
  absolute,
  connectionNode,
  linkableDiagrams,
  ancestors,
  materialKey,
  buildable,
  builtOutputIds,
  nodeDimensions,
  portY,
  sectionPortY,
  refreshBuildWarnings,
  documentKey,
  newNode,
  number,
  parsePort,
  portKey,
  reparent,
  uid,
  visibleNode,
  visibleConnections,
} from './model';
import { FactoryCard, type FactoryNode } from './nodes';
import { PlannerCanvas } from './canvas';
import { MaterialEdge, connectionCurve, connectionLabels, type MaterialEdgeType } from './edges';
import { Inspector } from './inspector';
import { SummaryView } from './summary-view';
import { PlanDialog } from './plan-dialog';
import { nodeSearchIndex, searchNodes } from './search';
import { orderedNodePorts } from './port-layout';
import { itemColor } from './item-color';
import { ConstructionStatus } from './construction-status';
import { PlannerConfirmation, type ConfirmationRequest } from './confirmation';
import { ChoiceSelect, MaterialSelect, MaterialIcon } from './pickers';
import { fShortenNumber, WattUnits } from '@/utils/format-number';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import '@xyflow/react/dist/style.css';
import './planner.css';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { arrangeDocument, arrangeNewNodes } from './layout';

const nodeTypes = { factory: FactoryCard };
const edgeTypes = { material: MaterialEdge };
const failedSyncSessions = new Set<string>();
const failedRefreshSessions = new Set<string>();
type AddLocation = { parentId: string; x: number; y: number; kind?: string };

const addKinds = [
  { kind: 'output', label: 'Output target', icon: Target, title: 'Add output target' },
  { kind: 'supply', label: 'Input', icon: PackagePlus, title: 'Add input' },
  { kind: 'input', label: 'Required input', icon: ArrowDownToLine, title: 'Add required input' },
  { kind: 'group', label: 'Factory section', icon: Layers, title: 'Add factory section' },
  { kind: 'link', label: 'Factory link', icon: Link2, title: 'Add factory link' },
];

function AddDialog({
  location,
  close,
  workspace,
  diagram,
  add,
}: {
  location: AddLocation;
  close: () => void;
  workspace: PlannerWorkspace;
  diagram: PlannerDiagram;
  add: (doc: PlannerDocument, expand: boolean) => void;
}) {
  const kind = location.kind ?? 'output';
  const [item, setItem] = useState('');
  const [rate, setRate] = useState('');
  const [inputRateMode, setInputRateMode] = useState('calculated');
  const [outputRateMode, setOutputRateMode] = useState('fixed');
  const [exposed, setExposed] = useState(false);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const factories = linkableDiagrams(workspace.diagrams, diagram.id);
  const valid =
    kind === 'group'
      ? !!name.trim()
      : kind === 'link'
        ? !!link
        : !!item &&
          ((kind === 'input' && inputRateMode === 'calculated') ||
            (kind === 'output' && outputRateMode === 'demand') ||
            (rate.trim() !== '' && Number.isFinite(Number(rate)) && Number(rate) > 0));
  const title = addKinds.find((k) => k.kind === kind)!.title;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const n = {
              ...newNode(kind, location.parentId, location.x, location.y),
              itemId: item,
              rate: kind === 'output' && outputRateMode === 'demand' ? 0 : Number(rate),
              inputRateMode,
              outputRateMode,
              exposed: kind === 'output' && exposed,
              linkedDiagramId: link,
              name:
                kind === 'group'
                  ? name.trim()
                  : kind === 'link'
                    ? workspace.diagrams.find((d) => d.id === link)!.document.name
                    : workspace.catalog.items.find((i) => i.id === item)!.name,
            };
            add(
              { ...diagram.document, nodes: [...diagram.document.nodes, n] },
              ['output', 'supply', 'input', 'link'].includes(kind)
            );
            close();
          }}
        >
          {kind === 'group' ? (
            <Input
              autoFocus
              aria-label="Section name"
              placeholder="Section name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          ) : kind === 'link' ? (
            <ChoiceSelect
              aria-label="Factory"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            >
              <option value="">Choose a factory…</option>
              {factories.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.document.name}
                </option>
              ))}
            </ChoiceSelect>
          ) : (
            <>
              <MaterialSelect
                items={workspace.catalog.items}
                value={item}
                onChange={setItem}
                defaultOpen
              />
              {kind === 'input' && (
                <ChoiceSelect
                  aria-label="Required input rate"
                  value={inputRateMode}
                  onChange={(e) => setInputRateMode(e.target.value)}
                >
                  <option value="calculated">Calculated from outputs</option>
                  <option value="fixed">Fixed rate from parent</option>
                </ChoiceSelect>
              )}
              {kind === 'output' && (
                <>
                  <ChoiceSelect
                    aria-label="Output mode"
                    value={outputRateMode}
                    onChange={(e) => {
                      setOutputRateMode(e.target.value);
                      if (e.target.value === 'demand') setExposed(true);
                    }}
                  >
                    <option value="fixed">Fixed output</option>
                    <option value="demand">Follow demand</option>
                  </ChoiceSelect>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={exposed}
                      onCheckedChange={(checked) => {
                        setExposed(checked === true);
                        if (checked !== true) setOutputRateMode('fixed');
                      }}
                    />
                    Expose to parent
                  </label>
                </>
              )}
              {(kind !== 'input' || inputRateMode === 'fixed') &&
                (kind !== 'output' || outputRateMode === 'fixed') && (
                  <div className="relative">
                    <Input
                      aria-label="Rate per minute"
                      type="number"
                      min="0"
                      step="any"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      className="pr-14"
                    />
                    <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted-foreground">
                      /min
                    </span>
                  </div>
                )}
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid}>
              {title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Editor({
  sessionId,
  diagram,
  workspace: savedWorkspace,
  reload,
  calculating,
}: {
  sessionId: string;
  diagram: PlannerDiagram;
  workspace: PlannerWorkspace;
  reload: (calculate?: boolean) => Promise<void>;
  calculating: boolean;
}) {
  const navigate = useNavigate();
  const flow = useReactFlow<FactoryNode>();
  const [preview, setPreview] = useState<{
    workspace: PlannerWorkspace;
    baseRevision: string;
  } | null>(null);
  const workspace =
    preview?.baseRevision === savedWorkspace.revision ? preview.workspace : savedWorkspace;
  const calculatedDiagram = workspace.diagrams.find((d) => d.id === diagram.id) ?? diagram;
  const [doc, setDoc] = useState<PlannerDocument>(diagram.document);
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [inspector, setInspector] = useState<'selection' | 'diagram' | null>(null);
  const [view, setView] = useState<'diagram' | 'summary'>('diagram');
  const [search, setSearch] = useState('');
  const searchContainer = useRef<HTMLDivElement>(null);
  const searchIndex = useMemo(
    () => nodeSearchIndex(doc, workspace.catalog, workspace.diagrams),
    [doc, workspace.catalog, workspace.diagrams]
  );
  const searchResults = useMemo(
    () => searchNodes(doc, searchIndex, search),
    [doc, searchIndex, search]
  );
  const [add, setAdd] = useState<AddLocation | null>(null);
  const [menu, setMenu] = useState<{
    location?: AddLocation;
    nodeId?: string;
    x: number;
    y: number;
  } | null>(null);
  const menuNode = doc.nodes.find((n) => n.id === menu?.nodeId);
  const [dirty, setDirty] = useState(false);
  const [namePending, setNamePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [savingCalculation, setSavingCalculation] = useState(false);
  const menuRequest = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const [, historyVersion] = useState(0);
  const current = useRef(doc),
    revision = useRef(diagram.revision),
    busy = useRef(false),
    blocking = useRef(false),
    pendingExpand = useRef(false),
    dirtyRef = useRef(false),
    alive = useRef(true);
  const history = useRef<{ past: PlannerDocument[]; future: PlannerDocument[] }>({
    past: [],
    future: [],
  });
  const worker = useRef<InstanceType<typeof ELK> | null>(null);
  const calculation = workspace.calculations.find((c) => c.diagramId === diagram.id);
  const validRates = !doc.nodes.some(
    (n) =>
      n.kind === 'input' && n.inputRateMode === 'fixed' && (!Number.isFinite(n.rate) || n.rate <= 0)
  );
  const mathDirty = useMemo(
    () => materialKey(doc) !== materialKey(calculatedDiagram.document),
    [doc, calculatedDiagram.document]
  );
  const stale = mathDirty || calculation?.calculationKey !== calculatedDiagram.calculationKey;
  const diagramConnections = useMemo(
    () => visibleConnections(doc, calculation, stale),
    [doc, calculation, stale]
  );
  const portLayoutKey = JSON.stringify([
    doc.nodes.map((n) => [
      n.id,
      n.kind,
      n.parentId,
      n.itemId,
      n.recipeId,
      n.linkedDiagramId,
      n.x,
      n.y,
      n.width,
      n.height,
      n.collapsed,
      n.exposed,
      n.inputRateMode,
      n.outputRateMode,
      n.disabledOutputs,
    ]),
    diagramConnections,
  ]);
  const nodePorts = useMemo(
    () =>
      orderedNodePorts(
        { ...doc, connections: diagramConnections },
        workspace.catalog,
        workspace.diagrams
      ),
    [portLayoutKey, workspace.catalog, workspace.diagrams]
  );
  const calculatingGraph = (calculating && stale) || savingCalculation;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      worker.current?.terminateWorker();
    };
  }, []);
  useEffect(() => {
    if (!dirtyRef.current && !busy.current) {
      current.current = diagram.document;
      setDoc(diagram.document);
      revision.current = diagram.revision;
      savedDocument.current = diagram.document;
    }
  }, [diagram]);
  const savedDocument = useRef(diagram.document);
  const edit = (next: PlannerDocument, expand = false, remember = true) => {
    if (blocking.current || (documentKey(next) === documentKey(current.current) && !expand)) return;
    if (remember) {
      history.current.past.push(current.current);
      history.current.past = history.current.past.slice(-50);
      history.current.future = [];
      historyVersion((v) => v + 1);
    }
    current.current = next;
    setDoc(next);
    dirtyRef.current = documentKey(next) !== documentKey(savedDocument.current);
    setDirty(dirtyRef.current);
    pendingExpand.current ||= expand;
  };
  const save = useCallback(async () => {
    if (
      busy.current ||
      current.current.nodes.some(
        (n) =>
          n.kind === 'input' &&
          n.inputRateMode === 'fixed' &&
          (!Number.isFinite(n.rate) || n.rate <= 0)
      )
    )
      return false;
    busy.current = true;
    setSaving(true);
    const needsCalculation =
      pendingExpand.current || materialKey(current.current) !== materialKey(diagram.document);
    blocking.current = needsCalculation;
    setSavingCalculation(needsCalculation);
    const submitted = current.current;
    try {
      let result = await plannerApi.save(
        sessionId,
        diagram.id,
        revision.current,
        current.current,
        pendingExpand.current
      );
      if (!alive.current) return;
      const addedNodes = result.document.nodes.some(
        (n) => !submitted.nodes.some((old) => old.id === n.id)
      );
      if (addedNodes) {
        const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
        try {
          const arranged = await arrangeNewNodes(
            result.document,
            submitted,
            elk,
            workspace.catalog,
            workspace.diagrams
          );
          if (alive.current && documentKey(arranged) !== documentKey(result.document)) {
            result = await plannerApi.save(sessionId, diagram.id, result.revision, arranged, false);
          }
        } catch (e) {
          console.error('Planner branch layout failed', e);
          if (alive.current) toast.error('Could not arrange the new branch.');
        } finally {
          elk.terminateWorker();
        }
      }
      revision.current = result.revision;
      savedDocument.current = result.document;
      if (current.current === submitted) {
        current.current = result.document;
        setDoc(result.document);
        setDirty(false);
        dirtyRef.current = false;
        pendingExpand.current = false;
      }
      await reload(needsCalculation);
      setPreview(null);
      if (addedNodes)
        setTimeout(() => {
          if (alive.current)
            void flow.fitView({
              padding: 0.15,
              duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
            });
        }, 100);
      return !dirtyRef.current;
    } catch (e) {
      if (alive.current) {
        console.error('Planner save failed', e);
        toast.error('Could not save changes. Please try again.', {
          id: `planner-save-${diagram.id}`,
        });
      }
      return false;
    } finally {
      busy.current = false;
      blocking.current = false;
      if (alive.current) {
        setSaving(false);
        setSavingCalculation(false);
      }
    }
  }, [
    sessionId,
    diagram.id,
    diagram.document,
    reload,
    flow,
    workspace.catalog,
    workspace.diagrams,
  ]);
  const calculate = async () => {
    if (busy.current || !validRates) return;
    busy.current = true;
    blocking.current = true;
    setSavingCalculation(true);
    const submitted = current.current;
    try {
      const next = await plannerApi.preview(sessionId, diagram.id, submitted);
      if (!alive.current) return;
      const result = next.diagrams.find((d) => d.id === diagram.id)!;
      const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
      try {
        result.document = await arrangeNewNodes(
          result.document,
          submitted,
          elk,
          next.catalog,
          next.diagrams
        );
      } finally {
        elk.terminateWorker();
      }
      if (!alive.current) return;
      blocking.current = false;
      edit(result.document);
      pendingExpand.current = false;
      setPreview({ workspace: refreshBuildWarnings(next), baseRevision: savedWorkspace.revision });
    } catch (e) {
      console.error('Planner calculation failed', e);
      toast.error('Could not calculate the plan. Your changes are still here.');
    } finally {
      busy.current = false;
      blocking.current = false;
      if (alive.current) setSavingCalculation(false);
    }
  };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (
      currentLocation.pathname === nextLocation.pathname &&
      currentLocation.search === nextLocation.search
    )
      return false;
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    return dirtyRef.current || busy.current;
  });
  const travel = (undo: boolean) => {
    if (blocking.current) return;
    const from = undo ? history.current.past : history.current.future,
      to = undo ? history.current.future : history.current.past;
    const next = from.pop();
    if (!next) return;
    to.push(current.current);
    edit(next, false, false);
    historyVersion((v) => v + 1);
  };
  const remove = (nodeId?: string) => {
    const ids = new Set(
      (nodeId ? [nodeId] : [selected, ...selection]).filter(
        (id) =>
          doc.nodes.some((n) => n.id === id && !n.generated) ||
          doc.connections.some((e) => e.id === id && !e.generated)
      )
    );
    if (!ids.size) return;
    const deleting = new Set(
      doc.nodes
        .filter((n) => ids.has(n.id) || ancestors(doc, n.id).some((p) => ids.has(p)))
        .map((n) => n.id)
    );
    const apply = () => {
      edit(
        {
          ...doc,
          nodes: doc.nodes.filter((n) => !deleting.has(n.id)),
          connections: doc.connections.filter(
            (e) => !ids.has(e.id) && !deleting.has(e.source) && !deleting.has(e.target)
          ),
        },
        doc.nodes.some((n) => deleting.has(n.id) && ['input', 'supply', 'output'].includes(n.kind))
      );
      setSelected('');
      setSelection([]);
      setInspector(null);
    };
    if (deleting.size > 1) {
      setConfirmation({
        title: `Remove ${deleting.size} nodes?`,
        description: 'Their connections will also be removed.',
        action: 'Remove nodes',
        confirm: apply,
      });
      return;
    }
    apply();
  };
  const openAdd = (
    point: { x: number; y: number },
    groupId?: string,
    screen?: { x: number; y: number }
  ) => {
    const hit =
      groupId ??
      doc.nodes
        .filter((n) => n.kind === 'group' && !n.collapsed && visibleNode(doc, n.id) === n.id)
        .sort((a, b) => ancestors(doc, b.id).length - ancestors(doc, a.id).length)
        .find((n) => {
          const p = absolute(doc, n.id);
          return (
            point.x >= p.x &&
            point.y >= p.y &&
            point.x <= p.x + n.width &&
            point.y <= p.y + n.height
          );
        })?.id ??
      '';
    const p = absolute(doc, hit);
    const location = { parentId: hit, x: point.x - p.x, y: point.y - p.y };
    if (screen) {
      const request = ++menuRequest.current;
      setMenu(null);
      requestAnimationFrame(() => {
        if (alive.current && request === menuRequest.current) setMenu({ location, ...screen });
      });
    } else setAdd(location);
  };
  const openNodeMenu = (nodeId: string, x: number, y: number) => {
    const node = current.current.nodes.find((n) => n.id === nodeId);
    if (!node || (node.generated && !buildable(node))) {
      setMenu(null);
      menuRequest.current++;
      return;
    }
    const point = flow.screenToFlowPosition({ x, y });
    const origin = absolute(current.current, nodeId);
    const location =
      node.kind === 'group'
        ? {
            parentId: nodeId,
            x: Math.max(24, point.x - origin.x),
            y: Math.max(72, point.y - origin.y),
          }
        : undefined;
    const request = ++menuRequest.current;
    setMenu(null);
    requestAnimationFrame(() => {
      if (alive.current && request === menuRequest.current) setMenu({ nodeId, location, x, y });
    });
  };
  useEffect(() => {
    const reopen = (event: MouseEvent) => {
      if (!menuRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const { clientX: x, clientY: y } = event;
      const request = ++menuRequest.current;
      setMenu(null);
      requestAnimationFrame(() => {
        if (!alive.current || request !== menuRequest.current) return;
        const bounds = surfaceRef.current?.getBoundingClientRect();
        if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)
          return;
        const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.react-flow__node');
        const node = current.current.nodes.find((n) => n.id === target?.dataset.id);
        if (node) openNodeMenu(node.id, x, y);
        else openAdd(flow.screenToFlowPosition({ x, y }), undefined, { x, y });
      });
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      menuRequest.current++;
      setMenu(null);
    };
    window.addEventListener('contextmenu', reopen, true);
    window.addEventListener('keydown', dismiss, true);
    return () => {
      window.removeEventListener('contextmenu', reopen, true);
      window.removeEventListener('keydown', dismiss, true);
    };
  });
  const arrange = () => {
    setArranging(true);
    worker.current?.terminateWorker();
    const snapshot = current.current;
    const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
    worker.current = elk;
    void arrangeDocument(snapshot, elk, workspace.catalog, workspace.diagrams)
      .then((positions) => {
        if (!alive.current) return;
        if (current.current !== snapshot) {
          toast.info('The diagram changed during arrangement. Try again.');
          return;
        }
        edit({ ...snapshot, nodes: snapshot.nodes.map((n) => ({ ...n, ...positions[n.id] })) });
        setTimeout(() => {
          if (alive.current)
            void flow.fitView({
              padding: 0.15,
              duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
            });
        }, 100);
      })
      .catch((error) => {
        console.error('Planner arrangement failed', error);
        if (alive.current) toast.error('Could not arrange this diagram.');
      })
      .finally(() => {
        elk.terminateWorker();
        if (alive.current) setArranging(false);
      });
  };

  const editRef = useRef(edit);
  editRef.current = edit;
  const selectEdge = useCallback((id: string) => {
    setSelected(id);
    setSelection([]);
    startTransition(() => setInspector('selection'));
  }, []);
  const nodeCache = useRef(new Map<string, FactoryNode>());
  const graphNodes = useMemo(() => {
    const completedOutputs = builtOutputIds(doc, diagram.id, workspace.diagrams);
    const nodes: FactoryNode[] = [...doc.nodes]
      .sort((a, b) => ancestors(doc, a.id).length - ancestors(doc, b.id).length)
      .filter((n) => visibleNode(doc, n.id) === n.id)
      .map((n) => {
        const ps = nodePorts.get(n.id)!;
        const dimensions = nodeDimensions(n, workspace.catalog, workspace.diagrams, ps);
        const result = calculation?.nodes.find((r) => r.nodeId === n.id);
        const warnings = calculation?.diagnostics.filter((d) => d.nodeId === n.id).length ?? 0;
        const searchMatches = searchResults.visible.get(n.id) ?? 0;
        const outputBuilt = completedOutputs.has(n.id);
        const cached = nodeCache.current.get(n.id);
        if (
          cached &&
          cached.data.node === n &&
          cached.data.ports === ps &&
          cached.data.catalog === workspace.catalog &&
          cached.data.result === result &&
          cached.data.warnings === warnings &&
          cached.data.searchMatches === searchMatches &&
          cached.data.outputBuilt === outputBuilt &&
          cached.width === dimensions.width &&
          cached.height === dimensions.height
        )
          return cached;
        return {
          id: n.id,
          type: 'factory',
          zIndex: n.kind === 'group' && !n.collapsed ? -1 : 2,
          position: { x: n.x, y: n.y },
          parentId: n.parentId || undefined,
          extent: n.parentId ? 'parent' : undefined,

          ...dimensions,
          measured: dimensions,
          style: dimensions,
          data: {
            node: n,
            searchMatches,
            outputBuilt,
            ports: ps,
            catalog: workspace.catalog,
            result,
            warnings,
            locked:
              workspace.catalog.unlocks.find((u) => u.recipeId === n.recipeId)?.unlocked === false,
            rememberResize: () => {
              history.current.past.push(current.current);
              history.current.past = history.current.past.slice(-50);
              history.current.future = [];
              historyVersion((v) => v + 1);
            },
            toggle: () =>
              editRef.current({
                ...current.current,
                nodes: current.current.nodes.map((v) =>
                  v.id === n.id ? { ...v, collapsed: !v.collapsed } : v
                ),
              }),
            open: () => {
              navigate(`/calculator/${n.linkedDiagramId}`);
            },
          },
        };
      });
    nodeCache.current = new Map(nodes.map((n) => [n.id, n]));
    return nodes;
  }, [
    doc,
    diagram.id,
    nodePorts,
    workspace.catalog,
    workspace.diagrams,
    calculation,
    searchResults,
    navigate,
  ]);
  const graphEdges = useMemo(() => {
    const nodes = graphNodes;
    const baseEdges = diagramConnections
      .map((e) => {
        const r = calculation?.connections.find((r) => r.connectionId === e.id);
        const item = workspace.catalog.items.find((item) => item.id === e.itemId);
        const accent = itemColor(item?.name);
        return {
          id: e.id,
          source: connectionNode(doc, e.source, true),
          target: connectionNode(doc, e.target, false),
          sourceHandle: portKey({
            nodeId: e.source,
            portId: e.sourcePort,
            itemId: e.itemId,
            source: true,
          }),
          targetHandle: portKey({
            nodeId: e.target,
            portId: e.targetPort,
            itemId: e.itemId,
            source: false,
          }),
          label: r
            ? `${number(r.rate, 1)}/min\u2002\u2002${r.requiredLines} × Mk.${r.tier}`
            : item?.name,
          zIndex: 0,
          style: {
            stroke: calculation?.diagnostics.some((d) => d.connectionId === e.id)
              ? 'var(--destructive)'
              : accent
                ? `color-mix(in oklab, ${accent} 65%, var(--muted-foreground))`
                : 'var(--muted-foreground)',
            strokeWidth: 1.5,
          },
          interactionWidth: 24,
        };
      })
      .filter((e) => e.source !== e.target);
    const endpoint = (id: string, handle: string, source: boolean) => {
      const node = nodes.find((n) => n.id === id)!;
      const position = absolute(doc, id);
      const ps = node.data.ports.filter((p) => p.source === source);
      return {
        x: position.x + (source ? node.width! : 0),
        y:
          position.y +
          (node.data.node.kind === 'group' &&
          !node.data.node.collapsed &&
          ps.some((p) => portKey(p) === handle)
            ? sectionPortY(doc, id, ps.find((p) => portKey(p) === handle)!)
            : portY(
                node.data.node,
                Math.max(
                  0,
                  ps.findIndex((p) => portKey(p) === handle)
                )
              )),
      };
    };
    const routes = baseEdges.map((e) => ({
      id: e.id,
      label: String(e.label ?? ''),
      source: endpoint(e.source, e.sourceHandle, true),
      target: endpoint(e.target, e.targetHandle, false),
    }));
    const labels = connectionLabels(
      routes,
      nodes
        .filter((n) => n.data.node.kind !== 'group' || n.data.node.collapsed)
        .map((n) => ({ ...absolute(doc, n.id), width: n.width!, height: n.height! }))
    );

    const edges: MaterialEdgeType[] = baseEdges.map((e, i) => ({
      ...e,
      type: 'material',
      data: {
        anchor: connectionCurve(routes[i].source, routes[i].target).point(0.5),
        warning: calculation?.diagnostics
          .filter((d) => d.connectionId === e.id)
          .map((d) => d.message)
          .join('; '),
        label: routes[i].label,
        box: labels.get(e.id)!,
        select: () => selectEdge(e.id),
      },
    }));
    return edges;
  }, [portLayoutKey, nodePorts, workspace.catalog, workspace.diagrams, calculation, selectEdge]);
  const nodes = useMemo(
    () => graphNodes.map((n) => (selection.includes(n.id) ? { ...n, selected: true } : n)),
    [graphNodes, selection]
  );
  const edges = useMemo(
    () =>
      graphEdges.map((e) => {
        const active = selected === e.id;
        const animated = selection.includes(e.source) || selection.includes(e.target);
        return active || animated
          ? {
              ...e,
              selected: active,
              animated,
              style: active ? { ...e.style, stroke: 'var(--primary)', strokeWidth: 3 } : e.style,
            }
          : e;
      }),
    [graphEdges, selection, selected]
  );
  const changes = (changes: NodeChange<FactoryNode>[]) => {
    const selectedChanges = changes.filter((c) => c.type === 'select');
    if (selectedChanges.length)
      setSelection((prev) => {
        const next = new Set(prev);
        selectedChanges.forEach((c) => {
          if (c.type === 'select') {
            if (c.selected) next.add(c.id);
            else next.delete(c.id);
          }
        });
        return [...next];
      });
    if (blocking.current) return;
    const moving = changes.filter(
      (c) =>
        (c.type === 'position' && c.dragging === false) ||
        (c.type === 'dimensions' && c.resizing === false)
    );
    if (!moving.length) return;
    const next = {
      ...current.current,
      nodes: current.current.nodes.map((n) => {
        let updated = n;
        for (const c of moving) {
          if (!('id' in c) || c.id !== n.id) continue;
          if (c.type === 'position' && c.position)
            updated = { ...updated, x: c.position.x, y: c.position.y };
          if (c.type === 'dimensions' && c.dimensions)
            updated = { ...updated, width: c.dimensions.width, height: c.dimensions.height };
        }
        return updated;
      }),
    };
    setDoc(next);
    if (
      moving.some(
        (c) =>
          (c.type === 'position' && c.dragging === false) ||
          (c.type === 'dimensions' && c.resizing === false)
      )
    )
      edit(next, false, false);
  };
  const canvas = useMemo(
    () => (
      <PlannerCanvas
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={changes}
        selectNodesOnDrag={false}
        nodeDragThreshold={4}
        nodesDraggable={!savingCalculation}
        className="transition-opacity duration-150 motion-reduce:transition-none"
        style={{ opacity: calculatingGraph ? 0.4 : 1 }}
        aria-busy={calculatingGraph}
        nodesConnectable={!savingCalculation}
        deleteKeyCode={null}
        elevateEdgesOnSelect={false}
        elevateNodesOnSelect={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
        onNodeDragStart={() => {
          history.current.past.push(current.current);
          history.current.future = [];
        }}
        onNodeClick={(e, n) => {
          setSelection((prev) =>
            e.shiftKey || e.metaKey || e.ctrlKey
              ? prev.includes(n.id)
                ? prev.filter((id) => id !== n.id)
                : [...prev, n.id]
              : [n.id]
          );
          setSelected(n.id);
          startTransition(() => setInspector('selection'));
        }}
        onEdgeClick={(_, e) => {
          setSelected(e.id);
          setSelection([]);
          startTransition(() => setInspector('selection'));
        }}
        onPaneClick={() => {
          setInspector(null);
          setSelected('');
          setSelection([]);
          setAdd(null);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openAdd(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), undefined, {
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          e.stopPropagation();
          openNodeMenu(n.id, e.clientX, e.clientY);
        }}
        isValidConnection={(c) => {
          const a = parsePort(c.sourceHandle),
            b = parsePort(c.targetHandle);
          return (
            !!a &&
            !!b &&
            a.source &&
            !doc.nodes.find((n) => n.id === a.nodeId)?.disabledOutputs?.includes(a.itemId) &&
            !b.source &&
            a.itemId === b.itemId &&
            a.nodeId !== b.nodeId &&
            !doc.connections.some(
              (e) =>
                e.source === a.nodeId &&
                e.sourcePort === a.portId &&
                e.target === b.nodeId &&
                e.targetPort === b.portId &&
                e.itemId === a.itemId
            )
          );
        }}
        onConnect={(c) => {
          const a = parsePort(c.sourceHandle),
            b = parsePort(c.targetHandle);
          if (!a || !b) return;
          edit(
            {
              ...doc,
              connections: [
                ...doc.connections,
                {
                  id: uid(),
                  source: a.nodeId,
                  target: b.nodeId,
                  sourcePort: a.portId,
                  targetPort: b.portId,
                  itemId: a.itemId,
                  availableLines: null,
                  generated: false,
                },
              ],
            },
            true
          );
        }}
      >
        <Background gap={24} size={1} color="var(--border)" />
        <Controls showInteractive={false} />

        {!doc.nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm text-center">
              <Calculator className="mx-auto mb-4 size-9 text-muted-foreground" />
              <h2 className="text-lg font-medium">Start with what you want to make</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Right-click anywhere to add an output. Set a rate, then connect your available
                resources. Use sections to divide your factory.
              </p>
            </div>
          </div>
        )}
      </PlannerCanvas>
    ),
    [nodes, edges, doc, calculatingGraph, savingCalculation, flow]
  );
  const inspectorEdit = useCallback(
    (next: PlannerDocument, expand?: boolean) => editRef.current(next, expand),
    []
  );
  const removeRef = useRef(remove);
  removeRef.current = remove;
  const inspectorRemove = useCallback(() => removeRef.current(), []);
  const production =
    calculation?.nodes.filter((r) =>
      doc.nodes.some((n) => n.id === r.nodeId && n.kind === 'production')
    ) ?? [];
  const warnings = calculation?.diagnostics ?? [];
  const displayDiagram = useMemo(() => ({ ...diagram, document: doc }), [diagram, doc]);
  return (
    <div className="planner flex h-[calc(100dvh-5.5rem-var(--status-bar-height,0px))] min-h-80 flex-col overflow-hidden rounded-xl border bg-background md:h-[calc(100dvh-3rem-var(--status-bar-height,0px))]">
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && !saving && !savingCalculation) blocker.reset?.();
        }}
      >
        <DialogContent showCloseButton={false} className="z-[51] sm:max-w-md">
          <DialogTitle>Unsaved changes</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Save your changes before leaving this plan?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving || savingCalculation}
              onClick={() => blocker.reset?.()}
            >
              Stay
            </Button>
            <Button
              variant="destructive"
              disabled={saving || savingCalculation}
              onClick={() => blocker.proceed?.()}
            >
              Discard
            </Button>
            <Button
              disabled={saving || savingCalculation || !validRates}
              onClick={async () => {
                if (await save()) blocker.proceed?.();
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to factories"
          disabled={saving}
          onClick={() => navigate('/calculator')}
        >
          <ArrowLeft size={17} />
        </Button>
        <div className="mr-auto flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 max-w-48 shrink-0">
            <h1 className="truncate text-sm font-semibold">{doc.name}</h1>
          </div>
          {view === 'diagram' && (
            <div
              className="flex min-w-32 max-w-md flex-1 items-center gap-2"
              role="search"
              aria-label="Diagram search"
            >
              <div ref={searchContainer} className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search diagram"
                  aria-describedby="diagram-search-results"
                  placeholder="Search nodes, materials, machines…"
                  className="h-8 pl-9 pr-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setSearch('');
                    }
                  }}
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 size-8"
                    aria-label="Clear diagram search"
                    onClick={() => {
                      setSearch('');
                      searchContainer.current?.querySelector('input')?.focus();
                    }}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
              <span
                id="diagram-search-results"
                role="status"
                className="shrink-0 text-xs text-muted-foreground"
              >
                {search.trim() &&
                  `${searchResults.matches.size} ${searchResults.matches.size === 1 ? 'match' : 'matches'}`}
              </span>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={(!dirty && !namePending) || saving || savingCalculation || !validRates}
          onClick={() => void save()}
        >
          <Save size={14} />
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {view === 'diagram' && (
          <Button
            variant="outline"
            size="sm"
            disabled={savingCalculation}
            onClick={(e) =>
              openAdd(
                flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
                doc.nodes.find((n) => n.id === selected)?.kind === 'group' ? selected : '',
                {
                  x: e.currentTarget.getBoundingClientRect().left,
                  y: e.currentTarget.getBoundingClientRect().bottom,
                }
              )
            }
          >
            <Plus size={14} />
            Add
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={saving || savingCalculation || arranging || !validRates}
          onClick={() => void calculate()}
        >
          <Calculator size={14} />
          Calculate
        </Button>
        {view === 'diagram' && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Arrange nodes"
              disabled={savingCalculation || arranging}
              onClick={arrange}
            >
              <Network size={16} />
              Arrange
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Undo"
              disabled={!history.current.past.length || savingCalculation}
              onClick={() => travel(true)}
            >
              <Undo2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo"
              disabled={!history.current.future.length || savingCalculation}
              onClick={() => travel(false)}
            >
              <Redo2 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Group selected nodes"
              disabled={
                !selection.length ||
                savingCalculation ||
                selection.some((id) => doc.nodes.find((n) => n.id === id)?.generated)
              }
              onClick={() => {
                const roots = selection.filter(
                  (id) => !ancestors(doc, id).some((p) => selection.includes(p))
                );
                const positions = roots.map((id) => absolute(doc, id));
                const group = {
                  ...newNode('group'),
                  x: Math.min(...positions.map((p) => p.x)) - 50,
                  y: Math.min(...positions.map((p) => p.y)) - 70,
                  width:
                    Math.max(
                      ...positions.map(
                        (p) =>
                          p.x +
                          (doc.nodes.find((n) => n.id === roots[positions.indexOf(p)])?.width ??
                            250)
                      )
                    ) -
                    Math.min(...positions.map((p) => p.x)) +
                    100,
                  height:
                    Math.max(...positions.map((p) => p.y)) -
                    Math.min(...positions.map((p) => p.y)) +
                    300,
                };
                edit(reparent({ ...doc, nodes: [...doc.nodes, group] }, roots, group.id), true);
                setSelected(group.id);
                setSelection([group.id]);
                startTransition(() => setInspector('selection'));
              }}
            >
              <Layers size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Diagram settings"
              onClick={() => {
                setSelected('');
                setSelection([]);
                setInspector((v) => (v === 'diagram' ? null : 'diagram'));
              }}
            >
              <Settings2 size={16} />
            </Button>
          </>
        )}
        <div
          role="group"
          aria-label="Planner view"
          className="flex overflow-hidden rounded-md border bg-muted/40"
        >
          {(['diagram', 'summary'] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={view === mode ? 'default' : 'ghost'}
              className="rounded-none"
              aria-pressed={view === mode}
              onClick={() => {
                setView(mode);
                setMenu(null);
              }}
            >
              {mode === 'diagram' ? <Network size={15} /> : <TableProperties size={15} />}
              {mode === 'diagram' ? 'Diagram' : 'Summary'}
            </Button>
          ))}
        </div>
      </div>

      <div className={view === 'summary' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <SummaryView workspace={workspace} diagram={displayDiagram} stale={stale} />
      </div>
      <div className={view === 'diagram' ? 'relative flex min-h-0 flex-1' : 'hidden'}>
        <div
          ref={surfaceRef}
          className="relative min-w-0 flex-1 outline-none"
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest('input,select,textarea')) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              remove();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
              e.preventDefault();
              travel(!e.shiftKey);
            }
          }}
          tabIndex={0}
        >
          {canvas}
          <div
            className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150 motion-reduce:transition-none ${calculatingGraph ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden={!calculatingGraph}
          >
            <div
              role="status"
              aria-label="Calculating production"
              className="rounded-full bg-background/90 p-3 shadow-sm"
            >
              <Spinner className="size-6" />
            </div>
          </div>
        </div>
        {(inspector === 'diagram' ||
          (inspector === 'selection' &&
            (doc.nodes.some((n) => n.id === selected) ||
              doc.connections.some((e) => e.id === selected)))) && (
          <aside className="flex flex-col absolute inset-x-0 bottom-0 z-20 max-h-[65%] overflow-auto rounded-t-xl border bg-background shadow-lg md:relative md:inset-auto md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-y-0 md:border-r-0">
            <button
              aria-label="Close inspector"
              className="absolute right-2 top-2 p-1"
              onClick={() => setInspector(null)}
            >
              <X size={15} />
            </button>
            <fieldset className="flex flex-1 flex-col" disabled={savingCalculation}>
              <Inspector
                onNamePendingChange={setNamePending}
                doc={doc}
                selected={inspector === 'diagram' ? '' : selected}
                workspace={workspace}
                calculation={calculation}
                stale={stale}
                edit={inspectorEdit}
                remove={inspectorRemove}
              />
            </fieldset>
          </aside>
        )}
      </div>
      {view === 'diagram' && (
        <>
          <div
            className="grid transition-[grid-template-rows,visibility] duration-150 ease-out motion-reduce:transition-none"
            aria-hidden={!showWarnings}
            style={{
              gridTemplateRows: showWarnings ? '1fr' : '0fr',
              visibility: showWarnings ? 'visible' : 'hidden',
            }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="max-h-48 overflow-auto border-t px-3 py-2 text-xs">
                {warnings.length ? (
                  <div className="grid grid-cols-[1.25rem_minmax(6rem,max-content)_minmax(10rem,1fr)] items-center gap-x-3">
                    {warnings.map((d, i) => {
                      const node = doc.nodes.find((n) => n.id === d.nodeId);
                      const item = workspace.catalog.items.find(
                        (item) => item.id === (d.itemId || node?.itemId)
                      );
                      return (
                        <button
                          key={i}
                          className="col-span-3 grid grid-cols-subgrid items-center rounded px-1 py-1.5 text-left hover:bg-accent"
                          onClick={() => {
                            setSelected(d.nodeId || d.connectionId);
                            setSelection(d.nodeId ? [d.nodeId] : []);
                            startTransition(() => setInspector('selection'));
                            if (d.nodeId)
                              void flow.fitView({
                                nodes: [{ id: visibleNode(doc, d.nodeId) }],
                                maxZoom: 1,
                              });
                          }}
                        >
                          {item ? (
                            <MaterialIcon key={item.id} name={item.name} className="size-5" />
                          ) : (
                            <AlertTriangle className="size-4 text-amber-500" />
                          )}
                          <span className="max-w-52 break-words font-medium">
                            {item?.name || node?.name || 'Diagram'}
                          </span>
                          <span className="text-muted-foreground">
                            {d.message}
                            {d.rate > 0
                              ? ` · ${number(d.rate)} ${item?.form === 'solid' ? 'items' : 'm³'}/min`
                              : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  'No production warnings.'
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <button
              className="flex items-center gap-1"
              aria-expanded={showWarnings}
              onClick={() => setShowWarnings((v) => !v)}
            >
              <AlertTriangle size={13} />
              {stale
                ? calculatingGraph
                  ? 'Calculating…'
                  : 'Results out of date'
                : `${warnings.length} warnings`}
            </button>
            <span>
              {
                doc.nodes.filter((n) => buildable(n) && n.kind !== 'group' && n.status === 'built')
                  .length
              }
              /{doc.nodes.filter((n) => buildable(n) && n.kind !== 'group').length} nodes built
            </span>
            <span>
              {calculation && !calculation.resolved ? (
                'Calculation unresolved'
              ) : !calculation ? (
                '—'
              ) : (
                <span className="inline-flex gap-5" aria-label="Power estimates">
                  <span>
                    PLANNED{' '}
                    <span className="ml-1 text-foreground">
                      {fShortenNumber(
                        production.reduce((s, n) => s + n.powerMax, 0) * 1e6,
                        WattUnits,
                        {
                          decimals: 0,
                        }
                      )}
                    </span>
                  </span>
                  <span>
                    PEAK{' '}
                    <span className="ml-1 text-foreground">
                      {fShortenNumber(
                        production.reduce((s, n) => s + n.installedPowerMax, 0) * 1e6,
                        WattUnits,
                        { decimals: 0 }
                      )}
                    </span>
                  </span>
                </span>
              )}
            </span>
          </div>
        </>
      )}
      {confirmation && (
        <PlannerConfirmation request={confirmation} close={() => setConfirmation(null)} />
      )}
      <DropdownMenu
        open={!!menu}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
      >
        <DropdownMenuTrigger
          className="pointer-events-none fixed size-0 opacity-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          tabIndex={-1}
          aria-hidden
        />
        <DropdownMenuContent
          key={menu ? `${menu.x}:${menu.y}` : 'closed'}
          align="start"
          className="w-56 duration-120 motion-reduce:animate-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {(!menuNode || menuNode.kind === 'group') && (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {doc.nodes.find((n) => n.id === menu?.location?.parentId)?.name || 'Main diagram'}
              </DropdownMenuLabel>
              {addKinds.map(({ kind, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={kind}
                  disabled={
                    savingCalculation ||
                    (kind === 'link' && !linkableDiagrams(workspace.diagrams, diagram.id).length)
                  }
                  onSelect={() => {
                    if (menu?.location) setAdd({ ...menu.location, kind });
                    setMenu(null);
                  }}
                >
                  <Icon />
                  {label}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {menuNode && (
            <>
              {menuNode.kind === 'group' && <DropdownMenuSeparator />}
              {buildable(menuNode) &&
                ['planned', 'building', 'built']
                  .filter((status) => status !== menuNode.status)
                  .map((status) => (
                    <DropdownMenuItem
                      key={status}
                      disabled={savingCalculation}
                      onSelect={() =>
                        edit({
                          ...doc,
                          nodes: doc.nodes.map((n) =>
                            n.id === menuNode.id ? { ...n, status } : n
                          ),
                        })
                      }
                    >
                      <ConstructionStatus value={status} />
                    </DropdownMenuItem>
                  ))}
              {!menuNode.generated && (
                <>
                  {buildable(menuNode) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={savingCalculation}
                    onSelect={() => remove(menuNode.id)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {add && (
        <AddDialog
          location={add}
          close={() => setAdd(null)}
          workspace={workspace}
          diagram={{ ...diagram, document: doc }}
          add={edit}
        />
      )}
    </div>
  );
}

function SessionPlanner({ sessionId }: { sessionId: string }) {
  const { diagramId } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<PlannerWorkspace | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<PlannerDiagram | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const currentWorkspace = useRef(workspace);
  const alive = useRef(true);
  const pending = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const reload = useCallback(
    (_calculate = true): Promise<void> => {
      pending.current = true;
      if (inFlight.current) return inFlight.current;
      const publish = (next: PlannerWorkspace) => {
        const annotated = refreshBuildWarnings(next);
        currentWorkspace.current = annotated;
        setWorkspace(annotated);
      };
      const run = async () => {
        while (pending.current && alive.current) {
          pending.current = false;
          try {
            const w = await plannerApi.load(sessionId);
            if (!alive.current) return;
            if (w.catalog.syncError && !failedSyncSessions.has(sessionId))
              toast.warning('Recipe sync unavailable. Using cached recipes.', {
                id: `planner-sync-${sessionId}`,
              });
            if (w.catalog.syncError) failedSyncSessions.add(sessionId);
            else failedSyncSessions.delete(sessionId);
            const cached = currentWorkspace.current?.calculations ?? [];
            const needsCalculation = w.diagrams.some(
              (d) =>
                !cached.some((c) => c.diagramId === d.id && c.calculationKey === d.calculationKey)
            );
            publish({
              ...w,
              calculations: cached.filter((c) => w.diagrams.some((d) => d.id === c.diagramId)),
            });
            setLoadFailed(false);
            if (needsCalculation) {
              setCalculating(true);
              const solved = await plannerApi.load(sessionId, true);
              if (!alive.current) return;
              if (!pending.current) publish(solved);
              else if (currentWorkspace.current)
                publish({ ...currentWorkspace.current, calculations: solved.calculations });
            }
            failedRefreshSessions.delete(sessionId);
          } catch (e) {
            console.error('Planner refresh failed', e);
            if (alive.current) {
              if (!failedRefreshSessions.has(sessionId))
                toast.error(
                  currentWorkspace.current
                    ? 'Could not update the plan. Please retry.'
                    : 'Could not load your plans. Please retry.',
                  { id: `planner-load-${sessionId}` }
                );
              failedRefreshSessions.add(sessionId);
              setLoadFailed(!currentWorkspace.current);
            }
          } finally {
            if (alive.current) setCalculating(false);
          }
        }
      };
      inFlight.current = run().finally(() => {
        inFlight.current = null;
      });
      return inFlight.current;
    },
    [sessionId]
  );
  useEffect(() => {
    alive.current = true;
    void reload();
    const subscription = plannerApi.watch(sessionId, (change) => {
      if (change.revision !== currentWorkspace.current?.revision) void reload();
    });
    return () => {
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [sessionId, reload]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      console.error('Planner action failed', e);
      toast.error('Could not delete the plan. Check whether another plan links to it.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const exportPlan = async (diagram: PlannerDiagram) => {
    setBusy(true);
    try {
      const json = await plannerApi.export(sessionId, diagram.id);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${
        diagram.document.name
          .replace(/[^\p{L}\p{N}_ -]/gu, '')
          .trim()
          .slice(0, 100) || 'plan'
      }.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Planner export failed', error);
      toast.error('Could not export the plan. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const diagram = workspace?.diagrams.find((d) => d.id === diagramId);
  return (
    <>
      {confirmation && (
        <PlannerConfirmation request={confirmation} close={() => setConfirmation(null)} />
      )}
      {(creating || duplicating) && workspace && (
        <PlanDialog
          catalogVersion={workspace.catalog.version}
          sessionId={sessionId}
          duplicate={duplicating ?? undefined}
          close={() => {
            setCreating(false);
            setDuplicating(null);
          }}
          created={async (id, keepOpen) => {
            await reload(false);
            if (!keepOpen) navigate(`/calculator/${id}`);
          }}
        />
      )}
      {!workspace ? (
        <div className="flex justify-center p-16">
          {loadFailed ? (
            <Button variant="outline" onClick={() => void reload()}>
              Retry loading plans
            </Button>
          ) : (
            <Spinner />
          )}
        </div>
      ) : diagram ? (
        <ReactFlowProvider key={diagram.id}>
          <Editor
            sessionId={sessionId}
            diagram={diagram}
            workspace={workspace}
            reload={reload}
            calculating={calculating}
          />
        </ReactFlowProvider>
      ) : diagramId ? (
        <div className="p-6">
          This factory does not exist in the selected session.{' '}
          <Button variant="link" onClick={() => navigate('/calculator')}>
            Open factory list
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h1 className="text-2xl font-semibold">Planner</h1>
            </div>
            <Button disabled={busy} onClick={() => setCreating(true)}>
              <Plus size={16} />
              New plan
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,1fr)_3.5rem] sm:grid-cols-[minmax(0,1.4fr)_minmax(6rem,1fr)_3.5rem] gap-2 sm:gap-6 border-b bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
              <span>Factory</span>
              <span className="text-center">Progress</span>
              <span aria-hidden="true" />
            </div>
            {workspace.diagrams.length ? (
              workspace.diagrams.map((d) => {
                const nodes = d.document.nodes.filter((n) => buildable(n) && n.kind !== 'group');
                const built = nodes.filter((n) => n.status === 'built').length;
                return (
                  <div
                    key={d.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,1fr)_3.5rem] sm:grid-cols-[minmax(0,1.4fr)_minmax(6rem,1fr)_3.5rem] items-center gap-2 sm:gap-6 border-b px-5 py-4 last:border-0"
                  >
                    <button className="text-left" onClick={() => navigate(`/calculator/${d.id}`)}>
                      <div className="font-medium hover:underline">{d.document.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {nodes.length} nodes · Updated{' '}
                        <time dateTime={d.updatedAt} className="sm:whitespace-nowrap">
                          {fDateTime(d.updatedAt)}
                        </time>
                      </div>
                    </button>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Progress
                        className="min-w-16 flex-1 bg-emerald-500/15 [&_[data-slot=progress-indicator]]:bg-emerald-500"
                        value={nodes.length ? (built / nodes.length) * 100 : 0}
                        aria-label={`${d.document.name} construction progress`}
                        getValueLabel={() => `${built} of ${nodes.length} nodes built`}
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {built}/{nodes.length} built
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent justify-self-center sm:justify-self-end sm:mr-3 disabled:opacity-50"
                        aria-label={`Actions for ${d.document.name}`}
                        disabled={busy}
                      >
                        <EllipsisVertical className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(`/calculator/${d.id}`)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDuplicating(d)}>
                          <Copy />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportPlan(d)}>
                          <Download />
                          Export JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setConfirmation({
                              title: `Delete “${d.document.name}”?`,
                              description: 'This permanently deletes the plan and its diagram.',
                              action: 'Delete plan',
                              confirm: () =>
                                action(async () => {
                                  await plannerApi.remove(sessionId, d.id, d.revision);
                                  await reload(false);
                                }),
                            })
                          }
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            ) : (
              <div className="px-6 py-16 text-center">
                <Network className="mx-auto mb-3 size-9 text-muted-foreground" />
                <p className="font-medium">No plans yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create a plan, then add an output to choose what you want to produce.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Session-owned production planning with persistent diagrams and shared factories. */
export function CalculatorView() {
  const { selectedSession } = useSession();
  return selectedSession ? (
    <SessionPlanner key={selectedSession.id} sessionId={selectedSession.id} />
  ) : (
    <p>Select a session to plan a factory.</p>
  );
}
