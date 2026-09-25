import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../leaflet-dark.css';
import { CRS } from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MachineCategory,
  ResourceNodePurity,
  ResourceNodePurityImpure,
  ResourceNodePurityNormal,
  ResourceNodePurityPure,
  ResourceType,
  ResourceTypeIronOre,
  ResourceTypeCopperOre,
  ResourceTypeLimestone,
  ResourceTypeCoal,
  ResourceTypeSAM,
  ResourceTypeSulfur,
  ResourceTypeCateriumOre,
  ResourceTypeBauxite,
  ResourceTypeRawQuartz,
  ResourceTypeUranium,
  ResourceTypeCrudeOil,
  ResourceTypeGeyser,
  ResourceTypeNitrogenGas,
} from 'src/apiTypes';
import { Iconify } from 'src/components/iconify';
import { ApiContext } from 'src/contexts/api/useApi';
import { SelectableEntity, SelectedMapItem, Selection } from 'src/types';
import { BuildingColorMode } from 'src/utils/gridColors';
import { useContextSelector } from 'use-context-selector';
import { MapBounds } from '../bounds';
import {
  addEntityToSelection,
  createSelection,
  filterSelectionByGameState,
  getEntityId,
  isEntityInSelection,
  removeEntityFromSelection,
} from '../hooks/useSelection';
import { Overlay } from '../overlay';
import { SelectionSidebar } from '../selectionSidebar';
import { computeTowerVisibilityData } from '../utils/resourceNodeUtils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const MAP_STATE_KEY = 'pioneer-hq-map-state';

type PersistedMapState = {
  enabledLayers: string[];
  buildingSubLayers: string[];
  infrastructureSubLayers: string[];
  vehicleSubLayers: string[];
  useGameMapStyle: boolean;
  buildingOpacity: number;
  buildingColorMode: BuildingColorMode;
  showVehicleNames: boolean;
  zoom: number;
  center: [number, number];
  resourceNodeFilter: {
    enabledCells: string[];
    exploitedFilter: string;
    radarVisibilityFilter: string;
  };
  showSelection: boolean;
};

const loadMapState = (): PersistedMapState | null => {
  try {
    const stored = localStorage.getItem(MAP_STATE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem(MAP_STATE_KEY);
    return null;
  }
};

const saveMapState = (state: PersistedMapState) => {
  try {
    localStorage.setItem(MAP_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
};

export type MapLayer = 'buildings' | 'infrastructure' | 'vehicles' | 'power' | 'resources';

export type ResourceNodeFilter = {
  enabledCells: Set<string>;
  exploitedFilter: 'all' | 'exploited' | 'notExploited';
  radarVisibilityFilter: 'all' | 'visible' | 'notVisible';
};

const allResourceTypes: { key: ResourceType; label: string; color: string }[] = [
  { key: ResourceTypeIronOre, label: 'Iron Ore', color: '#8B4513' },
  { key: ResourceTypeCopperOre, label: 'Copper Ore', color: '#B87333' },
  { key: ResourceTypeLimestone, label: 'Limestone', color: '#D4C4A8' },
  { key: ResourceTypeCoal, label: 'Coal', color: '#2C2C2C' },
  { key: ResourceTypeSulfur, label: 'Sulfur', color: '#FFFF00' },
  { key: ResourceTypeCateriumOre, label: 'Caterium Ore', color: '#FFD700' },
  { key: ResourceTypeRawQuartz, label: 'Raw Quartz', color: '#FFB6C1' },
  { key: ResourceTypeBauxite, label: 'Bauxite', color: '#CD853F' },
  { key: ResourceTypeUranium, label: 'Uranium Ore', color: '#00FF00' },
  { key: ResourceTypeSAM, label: 'SAM', color: '#9400D3' },
  { key: ResourceTypeCrudeOil, label: 'Crude Oil', color: '#1C1C1C' },
  { key: ResourceTypeNitrogenGas, label: 'Nitrogen Gas', color: '#87CEEB' },
  { key: ResourceTypeGeyser, label: 'Geyser', color: '#FF6347' },
];

const allPurities: { key: ResourceNodePurity; label: string; color: string }[] = [
  { key: ResourceNodePurityImpure, label: 'Impure', color: '#EF4444' },
  { key: ResourceNodePurityNormal, label: 'Normal', color: '#F59E0B' },
  { key: ResourceNodePurityPure, label: 'Pure', color: '#22C55E' },
];

const defaultResourceCells = allResourceTypes.flatMap((rt) =>
  allPurities.map((p) => `${rt.key}:${p.key}`)
);

export type BuildingSubLayer =
  | 'factory'
  | 'generator'
  | 'extractor'
  | 'trainStation'
  | 'droneStation'
  | 'truckStation'
  | 'storage'
  | 'spaceElevator'
  | 'hub'
  | 'radarTowers';

export type InfrastructureSubLayer = 'belts' | 'pipes' | 'railway' | 'hypertubes';

export type VehicleSubLayer =
  | 'trains'
  | 'drones'
  | 'trucks'
  | 'tractors'
  | 'explorers'
  | 'players'
  | 'paths';

const layerOptions: { key: MapLayer; label: string; expandable?: boolean }[] = [
  { key: 'buildings', label: 'Buildings', expandable: true },
  { key: 'infrastructure', label: 'Infrastructure', expandable: true },
  { key: 'vehicles', label: 'Vehicles', expandable: true },
  { key: 'power', label: 'Power' },
  { key: 'resources', label: 'Resources', expandable: true },
];

const buildingSubLayerOptions: { key: BuildingSubLayer; label: string; color: string }[] = [
  { key: 'factory', label: 'Factory', color: '#4056A1' },
  { key: 'extractor', label: 'Extractor', color: '#C97B2A' },
  { key: 'generator', label: 'Generator', color: '#2E8B8B' },
  { key: 'trainStation', label: 'Train stations', color: '#5A5A5A' },
  { key: 'droneStation', label: 'Drone stations', color: '#4A5A6A' },
  { key: 'truckStation', label: 'Truck stations', color: '#8B5A2B' },
  { key: 'storage', label: 'Storage', color: '#8B4513' },
  { key: 'spaceElevator', label: 'Space Elevator', color: '#9333EA' },
  { key: 'hub', label: 'HUB', color: '#F59E0B' },
  { key: 'radarTowers', label: 'Radar Towers', color: '#3B82F6' },
];

const infrastructureSubLayerOptions: {
  key: InfrastructureSubLayer;
  label: string;
  color: string;
}[] = [
  { key: 'belts', label: 'Belts', color: '#FFA500' },
  { key: 'pipes', label: 'Pipes', color: '#4169E1' },
  { key: 'railway', label: 'Railway', color: '#404040' },
  { key: 'hypertubes', label: 'Hypertubes', color: '#00CED1' },
];

const vehicleSubLayerOptions: { key: VehicleSubLayer; label: string; color: string }[] = [
  { key: 'trains', label: 'Trains', color: '#22c55e' },
  { key: 'drones', label: 'Drones', color: '#8B5CF6' },
  { key: 'trucks', label: 'Trucks', color: '#F59E0B' },
  { key: 'tractors', label: 'Tractors', color: '#22C55E' },
  { key: 'explorers', label: 'Explorers', color: '#06B6D4' },
  { key: 'players', label: 'Players', color: '#FF6B6B' },
  { key: 'paths', label: 'Vehicle Paths', color: '#9CA3AF' },
];

/**
 * Interactive map view component displaying the Satisfactory game world.
 * Renders a Leaflet map with customizable overlays for buildings, vehicles,
 * infrastructure, and resource nodes. Supports layer filtering, multi-selection,
 * and persistent state.
 */
export function MapView() {
  const isMobile = useIsMobile();
  const api = useContextSelector(ApiContext, (v) => {
    return {
      factoryStats: v.factoryStats,
      generatorStats: v.generatorStats,
      machines: v.machines,
      trainStations: v.trainStations,
      droneStations: v.droneStations,
      truckStations: v.truckStations,
      trains: v.trains,
      drones: v.drones,
      trucks: v.trucks,
      tractors: v.tractors,
      explorers: v.explorers,
      vehiclePaths: v.vehiclePaths,
      players: v.players,
      isLoading: v.isLoading,
      isOnline: v.isOnline,
      belts: v.belts,
      pipes: v.pipes,
      pipeJunctions: v.pipeJunctions,
      trainRails: v.trainRails,
      splitterMergers: v.splitterMergers,
      cables: v.cables,
      storages: v.storages,
      spaceElevator: v.spaceElevator,
      hub: v.hub,
      radarTowers: v.radarTowers,
      resourceNodes: v.resourceNodes,
      hypertubes: v.hypertubes,
      hypertubeEntrances: v.hypertubeEntrances,
    };
  });
  const [selectedItems, setSelectedItems] = useState<SelectedMapItem[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [zoom, setZoom] = useState(() => {
    const saved = loadMapState();
    return saved?.zoom ?? 3;
  });
  const [center, setCenter] = useState<[number, number]>(() => {
    const saved = loadMapState();
    return saved?.center ?? [-80, 80];
  });
  const [helpPopoverOpen, setHelpPopoverOpen] = useState(false);
  const [layersPopoverOpen, setLayersPopoverOpen] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [enabledLayers, setEnabledLayers] = useState<Set<MapLayer>>(() => {
    const saved = loadMapState();
    return saved ? new Set(saved.enabledLayers as MapLayer[]) : new Set();
  });
  const [buildingSubLayers, setBuildingSubLayers] = useState<Set<BuildingSubLayer>>(() => {
    const saved = loadMapState();
    return saved ? new Set(saved.buildingSubLayers as BuildingSubLayer[]) : new Set();
  });
  const [infrastructureSubLayers, setInfrastructureSubLayers] = useState<
    Set<InfrastructureSubLayer>
  >(() => {
    const saved = loadMapState();
    return saved ? new Set(saved.infrastructureSubLayers as InfrastructureSubLayer[]) : new Set();
  });
  const [vehicleSubLayers, setVehicleSubLayers] = useState<Set<VehicleSubLayer>>(() => {
    const saved = loadMapState();
    return saved ? new Set(saved.vehicleSubLayers as VehicleSubLayer[]) : new Set();
  });
  const [resourceNodeFilter, setResourceNodeFilter] = useState<ResourceNodeFilter>(() => {
    const saved = loadMapState();
    if (saved?.resourceNodeFilter) {
      return {
        enabledCells: new Set(saved.resourceNodeFilter.enabledCells),
        exploitedFilter: saved.resourceNodeFilter
          .exploitedFilter as ResourceNodeFilter['exploitedFilter'],
        radarVisibilityFilter: saved.resourceNodeFilter
          .radarVisibilityFilter as ResourceNodeFilter['radarVisibilityFilter'],
      };
    }
    return {
      enabledCells: new Set(defaultResourceCells),
      exploitedFilter: 'all',
      radarVisibilityFilter: 'all',
    };
  });
  const [showVehicleNames, setShowVehicleNames] = useState(() => {
    const saved = loadMapState();
    return saved?.showVehicleNames ?? true;
  });
  const [buildingColorMode, setBuildingColorMode] = useState<BuildingColorMode>(() => {
    const saved = loadMapState();
    return (saved?.buildingColorMode as BuildingColorMode) ?? 'type';
  });
  const [buildingOpacity, setBuildingOpacity] = useState(() => {
    const saved = loadMapState();
    return saved?.buildingOpacity ?? 0.5;
  });
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [expandedLayers, setExpandedLayers] = useState<Set<MapLayer>>(new Set());
  const [useGameMapStyle, setUseGameMapStyle] = useState(() => {
    const saved = loadMapState();
    return saved?.useGameMapStyle ?? false;
  });
  const [showSelection, setShowSelection] = useState(() => {
    const saved = loadMapState();
    return saved?.showSelection ?? true;
  });
  const [mapKey, setMapKey] = useState(0);

  const [isDragging, setIsDragging] = useState(false);
  const frozenDataRef = useRef<typeof api>(api);

  if (!isDragging) {
    frozenDataRef.current = api;
  }

  const displayData = isDragging ? frozenDataRef.current : api;

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    saveMapState({
      enabledLayers: [...enabledLayers],
      buildingSubLayers: [...buildingSubLayers],
      infrastructureSubLayers: [...infrastructureSubLayers],
      vehicleSubLayers: [...vehicleSubLayers],
      useGameMapStyle,
      buildingOpacity,
      buildingColorMode,
      showVehicleNames,
      zoom,
      center,
      resourceNodeFilter: {
        enabledCells: [...resourceNodeFilter.enabledCells],
        exploitedFilter: resourceNodeFilter.exploitedFilter,
        radarVisibilityFilter: resourceNodeFilter.radarVisibilityFilter,
      },
      showSelection,
    });
  }, [
    enabledLayers,
    buildingSubLayers,
    infrastructureSubLayers,
    vehicleSubLayers,
    useGameMapStyle,
    buildingOpacity,
    buildingColorMode,
    showVehicleNames,
    zoom,
    center,
    resourceNodeFilter,
    showSelection,
  ]);

  // Auto-remove entities from selection when they are removed from the game state
  useEffect(() => {
    setSelectedItems((prev) => {
      let hasChanges = false;
      const indicesToRemove: number[] = [];

      const newItems = prev.map((item, index) => {
        if (item.type !== 'selection') {
          return item;
        }

        const filteredSelection = filterSelectionByGameState(item.data, {
          machines: api.machines,
          storages: api.storages,
          trainStations: api.trainStations,
          droneStations: api.droneStations,
          radarTowers: api.radarTowers,
          hub: api.hub,
          spaceElevator: api.spaceElevator,
          trains: api.trains,
          drones: api.drones,
          trucks: api.trucks,
          tractors: api.tractors,
          explorers: api.explorers,
          players: api.players,
          belts: api.belts,
          pipes: api.pipes,
          cables: api.cables,
          trainRails: api.trainRails,
          hypertubes: api.hypertubes,
        });

        if (filteredSelection === null) {
          indicesToRemove.push(index);
          hasChanges = true;
          return item;
        }

        if (filteredSelection !== item.data) {
          hasChanges = true;
          return { type: 'selection' as const, data: filteredSelection };
        }

        return item;
      });

      if (!hasChanges) {
        return prev;
      }

      const filteredItems = newItems.filter((_, idx) => !indicesToRemove.includes(idx));

      if (indicesToRemove.length > 0) {
        setActiveTabIndex((prevIndex) => {
          if (filteredItems.length === 0) return 0;
          const removedBefore = indicesToRemove.filter((i) => i < prevIndex).length;
          const newIndex = prevIndex - removedBefore;
          if (newIndex >= filteredItems.length) return filteredItems.length - 1;
          return Math.max(0, newIndex);
        });
      }

      return filteredItems;
    });
  }, [
    api.machines,
    api.storages,
    api.trainStations,
    api.droneStations,
    api.radarTowers,
    api.hub,
    api.spaceElevator,
    api.trains,
    api.drones,
    api.trucks,
    api.tractors,
    api.explorers,
    api.players,
    api.belts,
    api.pipes,
    api.cables,
    api.trainRails,
    api.hypertubes,
  ]);

  const resetMapState = useCallback(() => {
    localStorage.removeItem(MAP_STATE_KEY);
    setEnabledLayers(new Set());
    setBuildingSubLayers(new Set());
    setInfrastructureSubLayers(new Set());
    setVehicleSubLayers(new Set());
    setUseGameMapStyle(false);
    setBuildingOpacity(0.5);
    setBuildingColorMode('type');
    setShowVehicleNames(true);
    setZoom(3);
    setCenter([-80, 80]);
    setResourceNodeFilter({
      enabledCells: new Set(defaultResourceCells),
      exploitedFilter: 'all',
      radarVisibilityFilter: 'all',
    });
    setShowSelection(true);
    setMapKey((k) => k + 1);
  }, []);

  const isSameSelection = (a: SelectedMapItem, b: SelectedMapItem): boolean => {
    if (a.type !== b.type) return false;
    switch (a.type) {
      case 'trainStation':
        return a.data.station.name === (b as typeof a).data.station.name;
      case 'droneStation':
        return a.data.station.name === (b as typeof a).data.station.name;
      case 'radarTower':
        return a.data.id === (b as typeof a).data.id;
      case 'hub':
        return a.data.id === (b as typeof a).data.id;
      case 'spaceElevator':
        return a.data.name === (b as typeof a).data.name;
      case 'selection':
        return a.data.id === (b as typeof a).data.id;
      default:
        return false;
    }
  };

  const addSelection = useCallback((item: SelectedMapItem) => {
    setSelectedItems((prev) => {
      const existingIndex = prev.findIndex((s) => isSameSelection(s, item));
      if (existingIndex >= 0) {
        setActiveTabIndex(existingIndex);
        return prev;
      }
      setActiveTabIndex(prev.length);
      return [...prev, item];
    });
  }, []);

  const removeSelection = useCallback((index: number) => {
    setSelectedItems((prev) => {
      const newItems = prev.filter((_, i) => i !== index);
      setActiveTabIndex((prevIndex) => {
        if (newItems.length === 0) return 0;
        if (prevIndex >= newItems.length) return newItems.length - 1;
        if (prevIndex > index) return prevIndex - 1;
        return prevIndex;
      });
      return newItems;
    });
  }, []);

  const clearSelections = useCallback(() => {
    setSelectedItems([]);
    setActiveTabIndex(0);
  }, []);

  const toggleLayer = (layer: MapLayer) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
        if (layer === 'buildings') {
          setBuildingSubLayers(new Set());
          setSelectedItems((prev) => {
            const filtered = prev.filter(
              (s) =>
                s.type !== 'trainStation' && s.type !== 'droneStation' && s.type !== 'radarTower'
            );
            if (filtered.length !== prev.length) {
              setActiveTabIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
            }
            return filtered;
          });
        }
        if (layer === 'infrastructure') {
          setInfrastructureSubLayers(new Set());
        }
        if (layer === 'vehicles') {
          setVehicleSubLayers(new Set());
        }
      } else {
        next.add(layer);
        if (layer === 'buildings') {
          setBuildingSubLayers(
            new Set([
              'factory',
              'generator',
              'extractor',
              'trainStation',
              'droneStation',
              'truckStation',
              'storage',
              'spaceElevator',
              'hub',
              'radarTowers',
            ])
          );
        }
        if (layer === 'infrastructure') {
          setInfrastructureSubLayers(new Set(['belts', 'pipes', 'railway', 'hypertubes']));
        }
        if (layer === 'vehicles') {
          setVehicleSubLayers(
            new Set(['trains', 'drones', 'trucks', 'tractors', 'explorers', 'players', 'paths'])
          );
        }
      }
      return next;
    });
  };

  const availablePuritiesByResource = useMemo(() => {
    const map = new Map<ResourceType, Set<ResourceNodePurity>>();
    for (const node of displayData.resourceNodes) {
      if (!map.has(node.resourceType)) {
        map.set(node.resourceType, new Set());
      }
      map.get(node.resourceType)!.add(node.purity);
    }
    return map;
  }, [displayData.resourceNodes]);

  const towerVisibilityData = useMemo(
    () => computeTowerVisibilityData(displayData.radarTowers),
    [displayData.radarTowers]
  );

  const getCellKey = (resourceType: ResourceType, purity: ResourceNodePurity) =>
    `${resourceType}:${purity}`;

  const isCellEnabled = (resourceType: ResourceType, purity: ResourceNodePurity) =>
    resourceNodeFilter.enabledCells.has(getCellKey(resourceType, purity));

  const toggleCell = (resourceType: ResourceType, purity: ResourceNodePurity) => {
    const key = getCellKey(resourceType, purity);
    setResourceNodeFilter((prev) => {
      const next = new Set(prev.enabledCells);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, enabledCells: next };
    });
  };

  const getResourceImageName = (resourceType: ResourceType): string => resourceType;

  const toggleBuildingSubLayer = (subLayer: BuildingSubLayer) => {
    setBuildingSubLayers((prev) => {
      const next = new Set(prev);
      if (next.has(subLayer)) {
        next.delete(subLayer);
        if (subLayer === 'trainStation') {
          setSelectedItems((prev) => {
            const filtered = prev.filter((s) => s.type !== 'trainStation');
            if (filtered.length !== prev.length) {
              setActiveTabIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
            }
            return filtered;
          });
        }
        if (subLayer === 'droneStation') {
          setSelectedItems((prev) => {
            const filtered = prev.filter((s) => s.type !== 'droneStation');
            if (filtered.length !== prev.length) {
              setActiveTabIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
            }
            return filtered;
          });
        }
        if (subLayer === 'radarTowers') {
          setSelectedItems((prev) => {
            const filtered = prev.filter((s) => s.type !== 'radarTower');
            if (filtered.length !== prev.length) {
              setActiveTabIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
            }
            return filtered;
          });
        }
      } else {
        next.add(subLayer);
      }
      if (next.size === 0) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.delete('buildings');
          return nextLayers;
        });
      } else if (!enabledLayers.has('buildings')) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.add('buildings');
          return nextLayers;
        });
      }
      return next;
    });
  };

  const toggleInfrastructureSubLayer = (subLayer: InfrastructureSubLayer) => {
    setInfrastructureSubLayers((prev) => {
      const next = new Set(prev);
      if (next.has(subLayer)) {
        next.delete(subLayer);
      } else {
        next.add(subLayer);
      }
      if (next.size === 0) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.delete('infrastructure');
          return nextLayers;
        });
      } else if (!enabledLayers.has('infrastructure')) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.add('infrastructure');
          return nextLayers;
        });
      }
      return next;
    });
  };

  const toggleVehicleSubLayer = (subLayer: VehicleSubLayer) => {
    setVehicleSubLayers((prev) => {
      const next = new Set(prev);
      if (next.has(subLayer)) {
        next.delete(subLayer);
      } else {
        next.add(subLayer);
      }
      if (next.size === 0) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.delete('vehicles');
          return nextLayers;
        });
      } else if (!enabledLayers.has('vehicles')) {
        setEnabledLayers((prevLayers) => {
          const nextLayers = new Set(prevLayers);
          nextLayers.add('vehicles');
          return nextLayers;
        });
      }
      return next;
    });
  };

  const toggleLayerExpansion = (layer: MapLayer) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  const visibleBuildingCategories = new Set<MachineCategory>(
    Array.from(buildingSubLayers)
      .map((sub): MachineCategory | null => {
        switch (sub) {
          case 'factory':
            return 'factory' as MachineCategory;
          case 'extractor':
            return 'extractor' as MachineCategory;
          case 'generator':
            return 'generator' as MachineCategory;
          default:
            return null;
        }
      })
      .filter((cat): cat is MachineCategory => cat !== null)
  );

  const handleSelectItem = (item: SelectedMapItem | null) => {
    console.log('handleSelectItem called with:', item?.type, item);
    if (item === null) {
      // Empty selection (e.g., selection rectangle with no entities) - do nothing
      // This preserves existing selections instead of clearing them
      return;
    }
    const existingIndex = selectedItems.findIndex((s) => isSameSelection(s, item));
    if (existingIndex >= 0) {
      removeSelection(existingIndex);
    } else {
      addSelection(item);
    }
    if (multiSelectMode) {
      setMultiSelectMode(false);
    }
  };

  /**
   * Handles Ctrl+click (or Cmd+click on Mac) to add an entity to the current selection.
   * If no selection exists, creates a new selection with the entity.
   * If a selection exists, adds the entity to it (or removes it if already selected).
   */
  const handleCtrlClickEntity = useCallback(
    (entity: SelectableEntity) => {
      const entityId = getEntityId(entity);

      // Find existing selection in selectedItems
      const existingSelectionIndex = selectedItems.findIndex((item) => item.type === 'selection');
      const existingSelection =
        existingSelectionIndex >= 0
          ? (selectedItems[existingSelectionIndex] as { type: 'selection'; data: Selection })
          : null;

      if (existingSelection) {
        // Check if entity is already in the selection
        const isAlreadySelected = isEntityInSelection(
          existingSelection.data,
          entity.type,
          entityId
        );

        if (isAlreadySelected) {
          // Remove the entity from selection
          const updatedSelection = removeEntityFromSelection(
            existingSelection.data,
            entity.type,
            entityId
          );
          if (updatedSelection.totalCount === 0) {
            // Selection is now empty, remove the selection tab
            removeSelection(existingSelectionIndex);
          } else {
            // Update the selection in place
            setSelectedItems((prev) =>
              prev.map((item, idx) =>
                idx === existingSelectionIndex
                  ? { type: 'selection', data: updatedSelection }
                  : item
              )
            );
          }
        } else {
          // Add the entity to the existing selection
          const updatedSelection = addEntityToSelection(existingSelection.data, entity);
          setSelectedItems((prev) =>
            prev.map((item, idx) =>
              idx === existingSelectionIndex ? { type: 'selection', data: updatedSelection } : item
            )
          );
          setActiveTabIndex(existingSelectionIndex);
        }
      } else {
        // No existing selection - create a new one with this entity
        const newSelection = createSelection([entity]);
        addSelection({ type: 'selection', data: newSelection });
      }
    },
    [selectedItems, addSelection, removeSelection]
  );

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden">
      {/* Loading Backdrop */}
      {api.isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Spinner className="size-8 text-primary" />
        </div>
      )}

      {!api.isLoading && (
        <div
          className={cn(
            'fixed inset-4 z-[1] pointer-events-none',
            !isMobile && 'left-[calc(var(--sidebar-width)+16px)]'
          )}
        >
          {/* Map Controls Buttons */}
          <div className="absolute top-4 right-4 z-[1001] flex gap-2 pointer-events-auto">
            {/* Reset Button */}
            <Tooltip>
              <TooltipTrigger
                onClick={resetMapState}
                className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-popover/90 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Iconify icon="mdi:refresh" className="size-5" />
              </TooltipTrigger>
              <TooltipContent>Reset map to defaults</TooltipContent>
            </Tooltip>

            {/* Map Style Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={() => setUseGameMapStyle(!useGameMapStyle)}
                  className="flex items-center bg-popover/90 backdrop-blur-sm rounded-md overflow-hidden cursor-pointer hover:bg-popover"
                >
                  <div
                    className={cn(
                      'p-1.5 flex items-center justify-center transition-all',
                      !useGameMapStyle
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Iconify icon="mdi:earth" className="size-5" />
                  </div>
                  <div
                    className={cn(
                      'p-1.5 flex items-center justify-center transition-all',
                      useGameMapStyle
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Iconify icon="mdi:gamepad-variant" className="size-5" />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {useGameMapStyle ? 'Switch to realistic map' : 'Switch to game map'}
              </TooltipContent>
            </Tooltip>

            {/* Multi-select toggle button */}
            <Tooltip>
              <TooltipTrigger
                onClick={() => setMultiSelectMode(!multiSelectMode)}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-md border border-input backdrop-blur-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                  multiSelectMode
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-popover/90'
                )}
              >
                <Iconify icon="mdi:selection-drag" className="size-5" />
              </TooltipTrigger>
              <TooltipContent>
                {multiSelectMode ? 'Disable multi-select mode' : 'Enable multi-select mode'}
              </TooltipContent>
            </Tooltip>

            {/* Layers Button */}
            <Popover open={layersPopoverOpen} onOpenChange={setLayersPopoverOpen}>
              <PopoverTrigger className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input bg-popover/90 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <Iconify icon="mdi:layers" className="size-5" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 max-h-[80vh] overflow-y-auto">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm">Layers</h4>
                  <div className="flex flex-col gap-1">
                    {layerOptions.map((layer) => (
                      <div key={layer.key}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={enabledLayers.has(layer.key)}
                              onCheckedChange={() => toggleLayer(layer.key)}
                            />
                            <span className="text-sm">{layer.label}</span>
                          </div>
                          {layer.expandable && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => toggleLayerExpansion(layer.key)}
                            >
                              <Iconify
                                icon={
                                  expandedLayers.has(layer.key)
                                    ? 'mdi:chevron-up'
                                    : 'mdi:chevron-down'
                                }
                                className="size-4"
                              />
                            </Button>
                          )}
                        </div>

                        {/* Building sub-layers */}
                        {layer.key === 'buildings' && (
                          <Collapsible open={expandedLayers.has('buildings')}>
                            <CollapsibleContent className="pl-6 flex flex-col gap-0.5">
                              {buildingSubLayerOptions.map((subLayer) => (
                                <div key={subLayer.key} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`building-${subLayer.key}`}
                                    checked={buildingSubLayers.has(subLayer.key)}
                                    onCheckedChange={() => toggleBuildingSubLayer(subLayer.key)}
                                    style={
                                      {
                                        '--checkbox-color': subLayer.color,
                                      } as React.CSSProperties
                                    }
                                    className="data-[state=checked]:bg-[var(--checkbox-color)] data-[state=checked]:border-[var(--checkbox-color)]"
                                  />
                                  <Label
                                    htmlFor={`building-${subLayer.key}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {subLayer.label}
                                  </Label>
                                </div>
                              ))}
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {/* Infrastructure sub-layers */}
                        {layer.key === 'infrastructure' && (
                          <Collapsible open={expandedLayers.has('infrastructure')}>
                            <CollapsibleContent className="pl-6 flex flex-col gap-0.5">
                              {infrastructureSubLayerOptions.map((subLayer) => (
                                <div key={subLayer.key} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`infra-${subLayer.key}`}
                                    checked={infrastructureSubLayers.has(subLayer.key)}
                                    onCheckedChange={() =>
                                      toggleInfrastructureSubLayer(subLayer.key)
                                    }
                                    style={
                                      {
                                        '--checkbox-color': subLayer.color,
                                      } as React.CSSProperties
                                    }
                                    className="data-[state=checked]:bg-[var(--checkbox-color)] data-[state=checked]:border-[var(--checkbox-color)]"
                                  />
                                  <Label
                                    htmlFor={`infra-${subLayer.key}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {subLayer.label}
                                  </Label>
                                </div>
                              ))}
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {/* Vehicles sub-layers */}
                        {layer.key === 'vehicles' && (
                          <Collapsible open={expandedLayers.has('vehicles')}>
                            <CollapsibleContent className="pl-6 flex flex-col gap-0.5">
                              {vehicleSubLayerOptions.map((subLayer) => (
                                <div key={subLayer.key} className="flex items-center gap-2">
                                  <Checkbox
                                    id={`vehicle-${subLayer.key}`}
                                    checked={vehicleSubLayers.has(subLayer.key)}
                                    onCheckedChange={() => toggleVehicleSubLayer(subLayer.key)}
                                    style={
                                      {
                                        '--checkbox-color': subLayer.color,
                                      } as React.CSSProperties
                                    }
                                    className="data-[state=checked]:bg-[var(--checkbox-color)] data-[state=checked]:border-[var(--checkbox-color)]"
                                  />
                                  <Label
                                    htmlFor={`vehicle-${subLayer.key}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {subLayer.label}
                                  </Label>
                                </div>
                              ))}
                              <Separator className="my-1" />
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id="show-vehicle-names"
                                  checked={showVehicleNames}
                                  onCheckedChange={(checked) =>
                                    setShowVehicleNames(checked === true)
                                  }
                                />
                                <Label
                                  htmlFor="show-vehicle-names"
                                  className="text-xs text-muted-foreground"
                                >
                                  Show names
                                </Label>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {/* Resources filter */}
                        {layer.key === 'resources' && (
                          <Collapsible open={expandedLayers.has('resources')}>
                            <CollapsibleContent className="pl-6 pt-2 flex flex-col gap-2">
                              {/* Resource matrix */}
                              <div className="flex flex-col gap-1 mb-2">
                                {allResourceTypes.map((rt) => (
                                  <div
                                    key={rt.key}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="text-[0.65rem] text-muted-foreground min-w-[60px]">
                                      {rt.label}
                                    </span>
                                    <div className="flex gap-1">
                                      {allPurities.map((p) => {
                                        const isAvailable = availablePuritiesByResource
                                          .get(rt.key)
                                          ?.has(p.key);
                                        if (!isAvailable) {
                                          return <div key={p.key} className="w-6 h-6" />;
                                        }
                                        return (
                                          <button
                                            key={p.key}
                                            type="button"
                                            onClick={() => toggleCell(rt.key, p.key)}
                                            className={cn(
                                              'w-6 h-6 p-0 rounded-full bg-black/50 hover:bg-black/70 transition-opacity',
                                              isCellEnabled(rt.key, p.key)
                                                ? 'opacity-100'
                                                : 'opacity-30'
                                            )}
                                            style={{
                                              border: `2px solid ${p.color}`,
                                            }}
                                          >
                                            <img
                                              src={`assets/images/satisfactory/32x32/${getResourceImageName(rt.key)}.png`}
                                              alt={rt.label}
                                              className="w-4 h-4 object-contain mx-auto"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).style.display =
                                                  'none';
                                              }}
                                            />
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground mb-1">Filters</p>
                              <div className="flex flex-wrap gap-1">
                                <Badge
                                  variant={
                                    resourceNodeFilter.exploitedFilter === 'exploited'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  className={cn(
                                    'cursor-pointer text-[0.65rem] h-5',
                                    resourceNodeFilter.exploitedFilter === 'exploited' &&
                                      'bg-green-500 hover:bg-green-600'
                                  )}
                                  onClick={() =>
                                    setResourceNodeFilter((prev) => ({
                                      ...prev,
                                      exploitedFilter:
                                        prev.exploitedFilter === 'exploited' ? 'all' : 'exploited',
                                    }))
                                  }
                                >
                                  Exploited
                                </Badge>
                                <Badge
                                  variant={
                                    resourceNodeFilter.exploitedFilter === 'notExploited'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  className={cn(
                                    'cursor-pointer text-[0.65rem] h-5',
                                    resourceNodeFilter.exploitedFilter === 'notExploited' &&
                                      'bg-amber-500 hover:bg-amber-600'
                                  )}
                                  onClick={() =>
                                    setResourceNodeFilter((prev) => ({
                                      ...prev,
                                      exploitedFilter:
                                        prev.exploitedFilter === 'notExploited'
                                          ? 'all'
                                          : 'notExploited',
                                    }))
                                  }
                                >
                                  Not Exploited
                                </Badge>
                                <Badge
                                  variant={
                                    resourceNodeFilter.radarVisibilityFilter === 'visible'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  className={cn(
                                    'cursor-pointer text-[0.65rem] h-5',
                                    resourceNodeFilter.radarVisibilityFilter === 'visible' &&
                                      'bg-blue-500 hover:bg-blue-600'
                                  )}
                                  onClick={() =>
                                    setResourceNodeFilter((prev) => ({
                                      ...prev,
                                      radarVisibilityFilter:
                                        prev.radarVisibilityFilter === 'visible'
                                          ? 'all'
                                          : 'visible',
                                    }))
                                  }
                                >
                                  Radar Visible
                                </Badge>
                                <Badge
                                  variant={
                                    resourceNodeFilter.radarVisibilityFilter === 'notVisible'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  className={cn(
                                    'cursor-pointer text-[0.65rem] h-5',
                                    resourceNodeFilter.radarVisibilityFilter === 'notVisible' &&
                                      'bg-purple-500 hover:bg-purple-600'
                                  )}
                                  onClick={() =>
                                    setResourceNodeFilter((prev) => ({
                                      ...prev,
                                      radarVisibilityFilter:
                                        prev.radarVisibilityFilter === 'notVisible'
                                          ? 'all'
                                          : 'notVisible',
                                    }))
                                  }
                                >
                                  Not Radar Visible
                                </Badge>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Help Button (desktop only) */}
            {!isMobile && (
              <Popover open={helpPopoverOpen} onOpenChange={setHelpPopoverOpen}>
                <PopoverTrigger className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-popover/90 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                  <Iconify icon="mdi:help-circle-outline" className="size-5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56">
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm">Controls</h4>
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[0.7rem]">
                            Ctrl
                          </Badge>
                          <span className="text-sm">+ Drag</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Multi-select items on the map
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[0.7rem]">
                            Click
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">Select a single item</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[0.7rem]">
                            Scroll
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">Zoom in/out</p>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Settings Button */}
            <Popover open={settingsPopoverOpen} onOpenChange={setSettingsPopoverOpen}>
              <PopoverTrigger className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input bg-popover/90 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <Iconify icon="mdi:cog" className="size-5" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm">Map Settings</h4>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Building Opacity</Label>
                    <Slider
                      value={[buildingOpacity]}
                      onValueChange={([value]) => setBuildingOpacity(value)}
                      min={0}
                      max={1}
                      step={0.1}
                    />
                    <div className="text-right text-xs text-muted-foreground">
                      {Math.round(buildingOpacity * 100)}%
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Building Color Mode</Label>
                    <Select
                      value={buildingColorMode}
                      onValueChange={(value) => setBuildingColorMode(value as BuildingColorMode)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="type">By Type</SelectItem>
                        <SelectItem value="status">By Status</SelectItem>
                        <SelectItem value="grid">By Power Grid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Show Selection</Label>
                    <Switch checked={showSelection} onCheckedChange={setShowSelection} />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* MapContainer */}
          <MapContainer
            key={mapKey}
            center={center}
            maxBounds={MapBounds}
            crs={CRS.Simple}
            preferCanvas={true}
            attributionControl={false}
            zoom={zoom}
            minZoom={3}
            maxZoom={8}
            zoomDelta={0.25}
            zoomSnap={0.25}
            className="w-full h-full rounded-[10px] z-0 pointer-events-auto"
            style={{
              backgroundColor: '#0e0e0e',
              border: '1px solid #1e1e1e',
              boxShadow: '0 0 15px rgba(0, 0, 0, 0.8)',
            }}
          >
            <TileLayer
              key={useGameMapStyle ? 'game' : 'realistic'}
              url={`assets/images/satisfactory/map/1763022054/${useGameMapStyle ? 'game' : 'realistic'}/{z}/{x}/{y}.png`}
              tileSize={256}
              minZoom={3}
              maxZoom={8}
              noWrap={true}
            />
            <Overlay
              selectedItems={selectedItems}
              onSelectItem={handleSelectItem}
              onCtrlClickEntity={handleCtrlClickEntity}
              onZoomEnd={setZoom}
              onMoveEnd={setCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              multiSelectMode={multiSelectMode}
              isMobile={isMobile}
              enabledLayers={enabledLayers}
              belts={displayData.belts}
              pipes={displayData.pipes}
              pipeJunctions={displayData.pipeJunctions}
              trainRails={displayData.trainRails}
              splitterMergers={displayData.splitterMergers}
              cables={displayData.cables}
              machines={displayData.machines || []}
              storages={displayData.storages}
              visibleBuildingCategories={visibleBuildingCategories}
              trains={displayData.trains}
              drones={displayData.drones}
              trucks={displayData.trucks}
              tractors={displayData.tractors}
              explorers={displayData.explorers}
              vehiclePaths={displayData.vehiclePaths}
              players={displayData.players}
              infrastructureSubLayers={infrastructureSubLayers}
              vehicleSubLayers={vehicleSubLayers}
              trainStations={displayData.trainStations}
              droneStations={displayData.droneStations}
              truckStations={displayData.truckStations}
              buildingSubLayers={buildingSubLayers}
              showVehicleNames={showVehicleNames}
              buildingColorMode={buildingColorMode}
              buildingOpacity={buildingOpacity}
              spaceElevator={displayData.spaceElevator}
              hub={displayData.hub}
              radarTowers={displayData.radarTowers}
              resourceNodes={displayData.resourceNodes}
              resourceNodeFilter={resourceNodeFilter}
              towerVisibilityData={towerVisibilityData}
              hypertubes={displayData.hypertubes}
              hypertubeEntrances={displayData.hypertubeEntrances}
              selection={
                selectedItems[activeTabIndex]?.type === 'selection'
                  ? selectedItems[activeTabIndex].data
                  : undefined
              }
              showSelection={showSelection}
              isSelectionTabActive={selectedItems[activeTabIndex]?.type === 'selection'}
            />
          </MapContainer>

          {/* Only render sidebar on mobile or when something is selected */}
          {(isMobile || selectedItems.length > 0) && (
            <SelectionSidebar
              selectedItems={selectedItems}
              activeTabIndex={activeTabIndex}
              onTabChange={setActiveTabIndex}
              onTabClose={removeSelection}
              isMobile={isMobile}
              onClose={clearSelections}
            />
          )}
        </div>
      )}
    </div>
  );
}
