import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/contexts/sessions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  ancestors,
  groupPorts,
  materialKey,
  documentKey,
  sameViewport,
  newDocument,
  newNode,
  number,
  parsePort,
  portKey,
  ports,
  reparent,
  uid,
  visibleNode,
  readRecovery,
  writeRecovery,
  recoveryKey,
} from './model';
import { FactoryCard, type FactoryNode } from './nodes';
import { Inspector } from './inspector';
import { ChoiceSelect, MaterialPicker } from './pickers';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import '@xyflow/react/dist/style.css';
import './planner.css';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { arrangeDocument } from './layout';

const nodeTypes = { factory: FactoryCard };
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
  const [rate, setRate] = useState('60');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const imports = (id: string, seen = new Set<string>()): boolean => {
    if (id === diagram.id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      workspace.diagrams
        .find((d) => d.id === id)
        ?.document.nodes.some((n) => n.kind === 'link' && imports(n.linkedDiagramId, seen)) ?? false
    );
  };
  const valid =
    kind === 'group'
      ? !!name.trim()
      : kind === 'link'
        ? !!link
        : !!item &&
          (kind === 'input' ||
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
              rate: Number(rate),
              linkedDiagramId: link,
              name:
                kind === 'group'
                  ? name.trim()
                  : kind === 'link'
                    ? workspace.diagrams.find((d) => d.id === link)!.document.name
                    : workspace.catalog.items.find((i) => i.id === item)!.name,
            };
            add({ ...diagram.document, nodes: [...diagram.document.nodes, n] }, kind === 'output');
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
              {workspace.diagrams
                .filter((d) => !imports(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.document.name}
                  </option>
                ))}
            </ChoiceSelect>
          ) : (
            <>
              <MaterialPicker items={workspace.catalog.items} value={item} onChange={setItem} />
              {kind !== 'input' && (
                <div className="relative">
                  <Input
                    aria-label="Rate per minute"
                    placeholder="Rate per minute"
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
  workspace,
  reload,
}: {
  sessionId: string;
  diagram: PlannerDiagram;
  workspace: PlannerWorkspace;
  reload: (calculate?: boolean) => Promise<void>;
}) {
  const navigate = useNavigate();
  const flow = useReactFlow<FactoryNode>();
  const draftKey = recoveryKey(sessionId, diagram.id);
  const [recovered] = useState(() => readRecovery(draftKey));
  const [doc, setDoc] = useState<PlannerDocument>(recovered?.document ?? diagram.document);
  const [selected, setSelected] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [inspector, setInspector] = useState(false);
  const [add, setAdd] = useState<AddLocation | null>(null);
  const [menu, setMenu] = useState<{ location: AddLocation; x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(!!recovered);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(
    recovered && recovered.revision !== diagram.revision
      ? 'Recovered edits are based on an older revision. Export a recovery copy or reload before editing.'
      : ''
  );
  const [arranging, setArranging] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [, historyVersion] = useState(0);
  const current = useRef(doc),
    revision = useRef(recovered?.revision ?? diagram.revision),
    busy = useRef(false),
    pendingExpand = useRef(recovered?.expand ?? false),
    dirtyRef = useRef(!!recovered),
    alive = useRef(true);
  const history = useRef<{ past: PlannerDocument[]; future: PlannerDocument[] }>({
    past: [],
    future: [],
  });
  const worker = useRef<InstanceType<typeof ELK> | null>(null);
  const calculation = workspace.calculations.find((c) => c.diagramId === diagram.id);
  const stale =
    dirty ||
    calculation?.revision !== revision.current ||
    calculation?.catalogVersion !== workspace.catalog.version;
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
    } else if (!busy.current && diagram.revision !== revision.current) {
      setError(
        'The diagram changed elsewhere. Your edits are retained; reload or export a recovery copy before continuing.'
      );
    }
  }, [diagram]);
  const edit = (next: PlannerDocument, expand = false, remember = true) => {
    if (busy.current || (documentKey(next) === documentKey(current.current) && !expand)) return;
    if (!/CONFLICT|changed elsewhere|older revision|catalog changed/.test(error)) setError('');
    if (remember) {
      history.current.past.push(current.current);
      history.current.past = history.current.past.slice(-50);
      history.current.future = [];
      historyVersion((v) => v + 1);
    }
    current.current = next;
    setDoc(next);
    setDirty(true);
    dirtyRef.current = true;
    pendingExpand.current ||= expand;
    writeRecovery(draftKey, {
      document: next,
      revision: revision.current,
      expand: pendingExpand.current,
    });
  };
  const save = useCallback(
    async (expand = false) => {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      setError('');
      const needsCalculation =
        expand ||
        pendingExpand.current ||
        materialKey(current.current) !== materialKey(diagram.document);
      const submitted = current.current;
      try {
        const result = await plannerApi.save(
          sessionId,
          diagram.id,
          revision.current,
          current.current,
          expand || pendingExpand.current
        );
        if (JSON.stringify(readRecovery(draftKey)?.document) === JSON.stringify(submitted))
          writeRecovery(draftKey, null);
        if (!alive.current) return;
        const addedNodes = result.document.nodes.length > current.current.nodes.length;
        revision.current = result.revision;
        current.current = result.document;
        setDoc(result.document);
        setDirty(false);
        dirtyRef.current = false;
        pendingExpand.current = false;
        await reload(needsCalculation);
        if (addedNodes)
          setTimeout(() => {
            if (alive.current) void flow.fitView({ padding: 0.15 });
          }, 100);
      } catch (e) {
        if (alive.current) setError(String(e));
      } finally {
        busy.current = false;
        if (alive.current) setSaving(false);
      }
    },
    [sessionId, diagram.id, diagram.document, reload, flow, draftKey]
  );
  useEffect(() => {
    if (!dirty || error || saving) return;
    const t = setTimeout(() => void save(), 900);
    return () => clearTimeout(t);
  }, [doc, dirty, error, saving, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const travel = (undo: boolean) => {
    if (busy.current) return;
    const from = undo ? history.current.past : history.current.future,
      to = undo ? history.current.future : history.current.past;
    const next = from.pop();
    if (!next) return;
    to.push(current.current);
    edit(next, false, false);
    historyVersion((v) => v + 1);
  };
  const remove = () => {
    const ids = new Set([selected, ...selection]);
    const deleting = new Set(
      doc.nodes
        .filter((n) => ids.has(n.id) || ancestors(doc, n.id).some((p) => ids.has(p)))
        .map((n) => n.id)
    );
    if (
      deleting.size > 1 &&
      !window.confirm(`Remove ${deleting.size} nodes and their connections?`)
    )
      return;
    edit({
      ...doc,
      nodes: doc.nodes.filter((n) => !deleting.has(n.id)),
      connections: doc.connections.filter(
        (e) => !ids.has(e.id) && !deleting.has(e.source) && !deleting.has(e.target)
      ),
    });
    setSelected('');
    setSelection([]);
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
    if (screen) setMenu({ location, ...screen });
    else setAdd(location);
  };
  const arrange = () => {
    setArranging(true);
    worker.current?.terminateWorker();
    const snapshot = current.current;
    const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
    worker.current = elk;
    void arrangeDocument(snapshot, elk)
      .then((positions) => {
        if (!alive.current) return;
        if (current.current !== snapshot) {
          toast.info('The diagram changed during arrangement. Try again.');
          return;
        }
        edit({ ...snapshot, nodes: snapshot.nodes.map((n) => ({ ...n, ...positions[n.id] })) });
        setTimeout(() => {
          if (alive.current) void flow.fitView({ padding: 0.15 });
        }, 100);
      })
      .catch((error) => {
        if (alive.current) toast.error(`Could not arrange this diagram: ${String(error)}`);
      })
      .finally(() => {
        elk.terminateWorker();
        if (alive.current) setArranging(false);
      });
  };

  const nodes: FactoryNode[] = [...doc.nodes]
    .sort((a, b) => ancestors(doc, a.id).length - ancestors(doc, b.id).length)
    .filter((n) => visibleNode(doc, n.id) === n.id)
    .map((n) => {
      const ps =
        n.kind === 'group'
          ? groupPorts(doc, n.id, workspace.catalog, workspace.diagrams)
          : ports(n, workspace.catalog, workspace.diagrams);
      const dimensions = {
        width: n.kind === 'group' && !n.collapsed ? n.width : n.kind === 'link' ? 290 : 250,
        height:
          n.kind === 'group' && !n.collapsed
            ? n.height
            : Math.max(
                180,
                100 +
                  Math.max(ps.filter((p) => p.source).length, ps.filter((p) => !p.source).length) *
                    21
              ),
      };
      return {
        id: n.id,
        type: 'factory',
        position: { x: n.x, y: n.y },
        parentId: n.parentId || undefined,
        selected: selection.includes(n.id),
        ...dimensions,
        style: dimensions,
        data: {
          node: n,
          ports: ps,
          catalog: workspace.catalog,
          result: stale ? undefined : calculation?.nodes.find((r) => r.nodeId === n.id),
          warnings: calculation?.diagnostics.filter((d) => d.nodeId === n.id).length ?? 0,
          locked:
            workspace.catalog.unlocks.find((u) => u.recipeId === n.recipeId)?.unlocked === false,
          rememberResize: () => {
            history.current.past.push(current.current);
            history.current.past = history.current.past.slice(-50);
            history.current.future = [];
            historyVersion((v) => v + 1);
          },
          toggle: () =>
            edit({
              ...doc,
              nodes: doc.nodes.map((v) => (v.id === n.id ? { ...v, collapsed: !v.collapsed } : v)),
            }),
          open: () => {
            if (dirtyRef.current || busy.current) {
              toast.info('Wait for the diagram to finish saving before opening a factory.');
              return;
            }
            navigate(`/calculator/${n.linkedDiagramId}`);
          },
        },
      };
    });
  const edges = doc.connections
    .map((e) => {
      const r = stale ? undefined : calculation?.connections.find((r) => r.connectionId === e.id);
      return {
        id: e.id,
        source: visibleNode(doc, e.source),
        target: visibleNode(doc, e.target),
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
        selected: selected === e.id,
        label: r
          ? `${number(r.rate)}/min · ${r.requiredLines} × Mk.${r.tier}`
          : workspace.catalog.items.find((i) => i.id === e.itemId)?.name,
        style: {
          stroke: calculation?.diagnostics.some((d) => d.connectionId === e.id)
            ? 'var(--destructive)'
            : 'var(--muted-foreground)',
          strokeWidth: 1.5,
        },
        labelStyle: { fill: 'var(--foreground)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--card)' },
      };
    })
    .filter((e) => e.source !== e.target);
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
    if (busy.current) return;
    const moving = changes.filter(
      (c) => c.type === 'position' || (c.type === 'dimensions' && c.resizing !== undefined)
    );
    if (!moving.length) return;
    const next = {
      ...current.current,
      nodes: doc.nodes.map((n) => {
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
  const production =
    calculation?.nodes.filter((r) =>
      doc.nodes.some((n) => n.id === r.nodeId && n.kind === 'production')
    ) ?? [];
  const warnings = calculation?.diagnostics ?? [];
  return (
    <div className="planner flex h-[calc(100dvh-10rem)] min-h-[500px] flex-col overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to factories"
          disabled={dirty || saving}
          onClick={() => navigate('/calculator')}
        >
          <ArrowLeft size={17} />
        </Button>
        <div className="mr-auto min-w-24">
          <h1 className="text-sm font-semibold">{doc.name}</h1>
          <p className="text-[10px] text-muted-foreground">
            {saving
              ? 'Saving…'
              : error
                ? 'Not saved'
                : dirty
                  ? 'Unsaved changes'
                  : `Saved · revision ${revision.current}`}
            {stale ? ' · Calculation pending' : ''}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
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
        <Button
          variant="outline"
          size="sm"
          disabled={saving || arranging}
          onClick={() => void save(true)}
        >
          <Calculator size={14} />
          Calculate
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Arrange nodes"
          disabled={saving || arranging}
          onClick={arrange}
        >
          <Network size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo"
          disabled={!history.current.past.length || saving}
          onClick={() => travel(true)}
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Redo"
          disabled={!history.current.future.length || saving}
          onClick={() => travel(false)}
        >
          <Redo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Group selected nodes"
          disabled={!selection.length || saving}
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
                      (doc.nodes.find((n) => n.id === roots[positions.indexOf(p)])?.width ?? 250)
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
            setInspector(true);
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
            setInspector((v) => !v);
          }}
        >
          <Settings2 size={16} />
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs"
        >
          <span className="mr-auto">{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const a = document.createElement('a');
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' })
              );
              a.href = url;
              a.download = `${doc.name}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export recovery copy
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save()}>
            Retry
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (dirtyRef.current && !window.confirm('Discard unsaved edits and reload?')) return;
              dirtyRef.current = false;
              writeRecovery(draftKey, null);
              setDirty(false);
              setError('');
              await reload(true);
            }}
          >
            Reload
          </Button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div
          className="min-w-0 flex-1"
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
          <ReactFlow<FactoryNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={changes}
            nodesDraggable={!saving}
            nodesConnectable={!saving}
            deleteKeyCode={null}
            defaultViewport={doc.viewport}
            minZoom={0.1}
            maxZoom={2}
            onNodeDragStart={() => {
              history.current.past.push(current.current);
              history.current.future = [];
            }}
            onNodeClick={(_, n) => {
              setSelected(n.id);
              setInspector(true);
            }}
            onEdgeClick={(_, e) => {
              setSelected(e.id);
              setSelection([]);
              setInspector(true);
            }}
            onPaneClick={() => {
              setSelected('');
              setSelection([]);
              setAdd(null);
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              openAdd(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), undefined, {
                x: e.clientX,
                y: e.clientY,
              });
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              openAdd(
                flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                n.data.node.kind === 'group' ? n.id : n.data.node.parentId,
                { x: e.clientX, y: e.clientY }
              );
            }}
            onMoveEnd={(_, viewport) => {
              if (!sameViewport(current.current.viewport, viewport))
                edit({ ...current.current, viewport }, false, false);
            }}
            isValidConnection={(c) => {
              const a = parsePort(c.sourceHandle),
                b = parsePort(c.targetHandle);
              return !!a && !!b && a.source && !b.source && a.itemId === b.itemId;
            }}
            onConnect={(c) => {
              const a = parsePort(c.sourceHandle),
                b = parsePort(c.targetHandle);
              if (!a || !b) return;
              edit({
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
                  },
                ],
              });
            }}
          >
            <Background gap={24} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap
              className="!bg-card !border !border-border"
              nodeColor="var(--muted-foreground)"
              maskColor="transparent"
            />
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
          </ReactFlow>
        </div>
        {inspector && (
          <aside className="absolute inset-x-0 bottom-0 z-20 max-h-[65%] overflow-auto rounded-t-xl border bg-background shadow-lg md:relative md:inset-auto md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-y-0 md:border-r-0">
            <button
              aria-label="Close inspector"
              className="absolute right-2 top-2 p-1"
              onClick={() => setInspector(false)}
            >
              <X size={15} />
            </button>
            <fieldset disabled={saving}>
              <Inspector
                doc={doc}
                selected={selected}
                workspace={workspace}
                calculation={stale ? undefined : calculation}
                edit={edit}
                remove={remove}
              />
            </fieldset>
          </aside>
        )}
      </div>
      {showWarnings && (
        <div className="max-h-40 overflow-auto border-t px-3 py-2 text-xs">
          {warnings.length
            ? warnings.map((d, i) => (
                <button
                  key={i}
                  className="block py-1 text-left hover:underline"
                  onClick={() => {
                    setSelected(d.nodeId || d.connectionId);
                    setSelection(d.nodeId ? [d.nodeId] : []);
                    setInspector(true);
                    if (d.nodeId)
                      void flow.fitView({
                        nodes: [{ id: visibleNode(doc, d.nodeId) }],
                        maxZoom: 1,
                      });
                  }}
                >
                  {doc.nodes.find((n) => n.id === d.nodeId)?.name}: {d.message}{' '}
                  {d.rate > 0
                    ? `${number(d.rate)} ${workspace.catalog.items.find((i) => i.id === d.itemId)?.name}/min`
                    : ''}
                </button>
              ))
            : 'No production warnings.'}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <button className="flex items-center gap-1" onClick={() => setShowWarnings((v) => !v)}>
          <AlertTriangle size={13} />
          {stale ? 'Results pending' : `${warnings.length} warnings`}
        </button>
        <span>
          {doc.nodes.filter((n) => n.status === 'built' && n.kind !== 'group').length}/
          {doc.nodes.filter((n) => n.kind !== 'group').length} nodes built
        </span>
        <span>
          {calculation && !calculation.resolved
            ? 'Calculation unresolved'
            : stale
              ? '—'
              : `${number(production.reduce((s, n) => s + n.powerMax, 0))} MW planned · ${number(production.reduce((s, n) => s + n.installedPowerMax, 0))} MW installed peak`}
        </span>
      </div>
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
          align="start"
          className="w-56 duration-120 motion-reduce:animate-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {doc.nodes.find((n) => n.id === menu?.location.parentId)?.name || 'Main diagram'}
          </DropdownMenuLabel>
          {addKinds.map(({ kind, label, icon: Icon }) => (
            <DropdownMenuItem
              key={kind}
              onSelect={() => {
                if (menu) setAdd({ ...menu.location, kind });
                setMenu(null);
              }}
            >
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
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

function NewPlanDialog({
  catalogVersion,
  sessionId,
  close,
  created,
}: {
  catalogVersion: string;
  sessionId: string;
  close: () => void;
  created: (id: string, keepOpen: boolean) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const create = async (keepOpen: boolean) => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const doc = { ...newDocument(catalogVersion), name: name.trim() };
      const d = await plannerApi.save(sessionId, '', 0, doc);
      await created(d.id, keepOpen);
      if (keepOpen) {
        setName('');
        input.current?.focus();
      } else close();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !saving) close();
      }}
    >
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md">
        <DialogTitle>Create plan</DialogTitle>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
        >
          <Input
            ref={input}
            autoFocus
            aria-label="Plan name"
            placeholder="Plan name"
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={saving || !name.trim()}
              onClick={() => void create(true)}
            >
              Create another
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionPlanner({ sessionId }: { sessionId: string }) {
  const { diagramId } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<PlannerWorkspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const currentWorkspace = useRef(workspace);
  currentWorkspace.current = workspace;
  const generation = useRef(0);
  const reload = useCallback(
    async (calculate = true) => {
      const id = ++generation.current;
      try {
        const w = await plannerApi.load(sessionId);
        if (generation.current !== id) return;
        setWorkspace((prev) => ({
          ...w,
          calculations: calculate
            ? []
            : (prev?.calculations ?? []).map((c) => ({
                ...c,
                revision: w.diagrams.find((d) => d.id === c.diagramId)?.revision ?? c.revision,
                workspaceRevision: w.revision,
              })),
        }));
        setError('');
        if (calculate) {
          const solved = await plannerApi.load(sessionId, true);
          if (generation.current === id) setWorkspace(solved);
        }
      } catch (e) {
        if (generation.current === id) setError(String(e));
      }
    },
    [sessionId]
  );
  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  useEffect(() => {
    const subscription = plannerApi.watch(sessionId, (change) => {
      const previous = currentWorkspace.current;
      if (change.revision === previous?.revision) return;
      const calculate =
        !previous ||
        change.catalogVersion !== previous.catalog.version ||
        change.diagrams.length !== previous.diagrams.length ||
        change.diagrams.some(
          (d) => previous.diagrams.find((v) => v.id === d.id)?.revision !== d.revision
        );
      void reload(calculate);
    });
    return () => subscription.unsubscribe();
  }, [sessionId, reload]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const diagram = workspace?.diagrams.find((d) => d.id === diagramId);
  return (
    <>
      {creating && workspace && (
        <NewPlanDialog
          catalogVersion={workspace.catalog.version}
          sessionId={sessionId}
          close={() => setCreating(false)}
          created={async (id, keepOpen) => {
            await reload(false);
            if (!keepOpen) navigate(`/calculator/${id}`);
          }}
        />
      )}
      {workspace?.catalog.syncError && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {workspace.catalog.syncError}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          {error}
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
      {!workspace ? (
        !error && (
          <div className="flex justify-center p-16">
            <Spinner />
          </div>
        )
      ) : diagram ? (
        <ReactFlowProvider key={diagram.id}>
          <Editor sessionId={sessionId} diagram={diagram} workspace={workspace} reload={reload} />
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
            <div className="grid grid-cols-[1fr_auto_auto] gap-6 border-b bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
              <span>Factory</span>
              <span>Progress</span>
              <span>Actions</span>
            </div>
            {workspace.diagrams.length ? (
              workspace.diagrams.map((d) => {
                const nodes = d.document.nodes.filter((n) => n.kind !== 'group');
                const built = nodes.filter((n) => n.status === 'built').length;
                return (
                  <div
                    key={d.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-6 border-b px-5 py-4 last:border-0"
                  >
                    <button className="text-left" onClick={() => navigate(`/calculator/${d.id}`)}>
                      <div className="font-medium hover:underline">{d.document.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {nodes.length} nodes · Updated {new Date(d.updatedAt).toLocaleString()}
                      </div>
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {built}/{nodes.length} built
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete “${d.document.name}”?`))
                          void action(async () => {
                            await plannerApi.remove(sessionId, d.id, d.revision);
                            await reload();
                          });
                      }}
                    >
                      Delete
                    </Button>
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
