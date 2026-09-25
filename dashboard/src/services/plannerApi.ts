import { graphql } from 'src/gql';
import { client } from 'src/gql/client';
import type { PlannerDocumentInput } from 'src/gql/graphql';

const WorkspaceQuery = graphql(
  `query PlannerWorkspace($sessionId: ID!, $calculate: Boolean!) { plannerWorkspace(sessionId: $sessionId, calculate: $calculate) { revision catalog { version sourceHash syncError items { id name form resource sinkable unavailable } machines { id name power powerExponent boostPowerExponent boostSlots boostPerSlot variablePower minClock maxClock } recipes { id name alternate unavailable duration machineIds ingredients { itemId amount } products { itemId amount } powerConstant powerFactor } belts pipes unlocks { recipeId unlocked } } diagrams { id sessionId revision updatedAt document { version name description settings { recipes { itemId recipeId } beltTier pipeTier } nodes { id kind parentId name itemId recipeId machineId linkedDiagramId x y width height collapsed rate clock somersloops status generated fixedSupply settings { recipes { itemId recipeId } beltTier pipeTier } builtFingerprint } connections { id source target sourcePort targetPort itemId availableLines } viewport { x y zoom } catalogVersion } } calculations { resolved diagramId revision catalogVersion workspaceRevision nodes { nodeId machines equivalentMachines utilization somersloops powerKnown powerMin powerMax installedPowerMax inputs { itemId rate } outputs { itemId rate } fingerprint } connections { connectionId rate tier capacity requiredLines scopeId } diagnostics { diagramId nodeId connectionId code message itemId rate } } } }`
);
const ChangedSubscription = graphql(
  `subscription PlannerWorkspaceChanged($sessionId: ID!) { plannerWorkspaceChanged(sessionId: $sessionId) { revision catalogVersion diagrams { id revision } } }`
);
const SaveMutation = graphql(
  `mutation SavePlannerDiagram($sessionId: ID!, $id: ID!, $expectedRevision: Int!, $document: PlannerDocumentInput!, $expand: Boolean!) { savePlannerDiagram(sessionId: $sessionId, id: $id, expectedRevision: $expectedRevision, document: $document, expand: $expand) { id sessionId revision updatedAt document { version name description settings { recipes { itemId recipeId } beltTier pipeTier } nodes { id kind parentId name itemId recipeId machineId linkedDiagramId x y width height collapsed rate clock somersloops status generated fixedSupply settings { recipes { itemId recipeId } beltTier pipeTier } builtFingerprint } connections { id source target sourcePort targetPort itemId availableLines } viewport { x y zoom } catalogVersion } } }`
);
const DeleteMutation = graphql(
  `mutation DeletePlannerDiagram($sessionId: ID!, $id: ID!, $expectedRevision: Int!) { deletePlannerDiagram(sessionId: $sessionId, id: $id, expectedRevision: $expectedRevision) }`
);
function clean<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (key === '__typename' ? undefined : item))
  ) as T;
}

/** Persistent production planning operations on the same-origin GraphQL API. */
export const plannerApi = {
  async load(sessionId: string, calculate = false) {
    const res = await client
      .query(WorkspaceQuery, { sessionId, calculate }, { requestPolicy: 'network-only' })
      .toPromise();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) throw new Error('Could not load factory plans');
    return clean(res.data.plannerWorkspace);
  },
  watch(
    sessionId: string,
    onChange: (change: {
      revision: string;
      catalogVersion: string;
      diagrams: { id: string; revision: number }[];
    }) => void
  ) {
    return client.subscription(ChangedSubscription, { sessionId }).subscribe((res) => {
      if (res.data) onChange(res.data.plannerWorkspaceChanged);
    });
  },
  async save(
    sessionId: string,
    id: string,
    expectedRevision: number,
    document: PlannerDocumentInput,
    expand = false
  ) {
    const documentInput = JSON.parse(
      JSON.stringify(document, (key, value) => (key === '__typename' ? undefined : value))
    ) as PlannerDocumentInput;
    const res = await client
      .mutation(SaveMutation, { sessionId, id, expectedRevision, document: documentInput, expand })
      .toPromise();
    if (res.error) throw new Error(res.error.message);
    if (!res.data) throw new Error('Could not save factory plan');
    return clean(res.data.savePlannerDiagram);
  },
  async remove(sessionId: string, id: string, expectedRevision: number) {
    const res = await client
      .mutation(DeleteMutation, { sessionId, id, expectedRevision })
      .toPromise();
    if (res.error) throw new Error(res.error.message);
  },
};

export type PlannerWorkspace = Awaited<ReturnType<typeof plannerApi.load>>;
export type PlannerCatalog = PlannerWorkspace['catalog'];
export type PlannerDiagram = PlannerWorkspace['diagrams'][number];
export type PlannerCalculation = PlannerWorkspace['calculations'][number];
export type PlannerDocument = PlannerDiagram['document'];
export type PlannerNode = PlannerDocument['nodes'][number];
export type PlannerConnection = PlannerDocument['connections'][number];
