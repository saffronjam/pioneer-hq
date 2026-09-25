package frm_models

type Location struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Rotation float64 `json:"rotation"`
}

type BoundingBox struct {
	Min Location `json:"min"`
	Max Location `json:"max"`
}

type PowerInfo struct {
	PowerConsumed    float64 `json:"PowerConsumed"`
	MaxPowerConsumed float64 `json:"MaxPowerConsumed"`
	CircuitID        int     `json:"CircuitID"`
	CircuitGroupID   int     `json:"CircuitGroupID"`
}

type ItemAmount struct {
	Name   string  `json:"Name"`
	Amount float64 `json:"Amount"`
}

type Production struct {
	Name        string  `json:"Name"`
	Amount      float64 `json:"Amount"` // Stored amount
	CurrentProd float64 `json:"CurrentProd"`
	MaxProd     float64 `json:"MaxProd"`
	ProdPercent float64 `json:"ProdPercent"` // Efficiency 0-100
}

type Ingredient struct {
	Name            string  `json:"Name"`
	Amount          float64 `json:"Amount"` // Stored amount
	CurrentConsumed float64 `json:"CurrentConsumed"`
	MaxConsumed     float64 `json:"MaxConsumed"`
	ConsPercent     float64 `json:"ConsPercent"` // Efficiency 0-100
}

type Extractor struct {
	Name                string       `json:"Name"`
	IsProducing         bool         `json:"IsProducing"`
	IsPaused            bool         `json:"IsPaused"`
	IsConfigured        bool         `json:"IsConfigured"`
	IsFullSpeed         bool         `json:"IsFullSpeed"`
	CanStart            bool         `json:"CanStart"`
	BaseProd            float64      `json:"BaseProd"`
	DynamicProdCapacity float64      `json:"DynamicProdCapacity"`
	Location            Location     `json:"location"`
	BoundingBox         BoundingBox  `json:"BoundingBox"`
	PowerInfo           PowerInfo    `json:"PowerInfo"`
	Production          []Production `json:"production"`
}

type FactoryMachine struct {
	Name                string       `json:"Name"`
	IsProducing         bool         `json:"IsProducing"`
	IsPaused            bool         `json:"IsPaused"`
	IsConfigured        bool         `json:"IsConfigured"`
	IsFullSpeed         bool         `json:"IsFullSpeed"`
	CanStart            bool         `json:"CanStart"`
	BaseProd            float64      `json:"BaseProd"`
	DynamicProdCapacity float64      `json:"DynamicProdCapacity"`
	Productivity        float64      `json:"Productivity"` // 0-100 from FRM API
	Location            Location     `json:"location"`
	BoundingBox         BoundingBox  `json:"BoundingBox"`
	PowerInfo           PowerInfo    `json:"PowerInfo"`
	Ingredients         []Ingredient `json:"ingredients"`
	Production          []Production `json:"production"`
}

type Generator struct {
	Name                string      `json:"Name"`
	Location            Location    `json:"location"`
	BoundingBox         BoundingBox `json:"BoundingBox"`
	BaseProd            float64     `json:"BaseProd"`            // Base power production (MW)
	RegulatedDemandProd float64     `json:"RegulatedDemandProd"` // Current power production (MW) - used for most generators
	ProductionCapacity  float64     `json:"ProductionCapacity"`  // Power capacity (MW) - used for geothermal
	CircuitID           int         `json:"CircuitID"`
}

type Circuit struct {
	CircuitID           string  `json:"CircuitID"`
	PowerConsumed       float64 `json:"PowerConsumed"`       // MW
	PowerMaxConsumed    float64 `json:"PowerMaxConsumed"`    // MW
	PowerProduction     float64 `json:"PowerProduction"`     // MW
	PowerCapacity       float64 `json:"PowerCapacity"`       // MW
	BatteryPercent      float64 `json:"BatteryPercent"`      // 0-100
	BatteryCapacity     float64 `json:"BatteryCapacity"`     // MWh
	BatteryDifferential float64 `json:"BatteryDifferential"` // MW
	BatteryTimeFull     *string `json:"BatteryTimeFull"`     // "HH:MM:SS", nullable
	BatteryTimeEmpty    *string `json:"BatteryTimeEmpty"`    // "HH:MM:SS", nullable
	FuseTriggered       bool    `json:"FuseTriggered"`
}

type ProdStatItem struct {
	Name            string  `json:"Name"`
	CurrentProd     float64 `json:"CurrentProd"`
	MaxProd         float64 `json:"MaxProd"`
	ProdPercent     float64 `json:"ProdPercent"`
	CurrentConsumed float64 `json:"CurrentConsumed"`
	MaxConsumed     float64 `json:"MaxConsumed"`
	ConsPercent     float64 `json:"ConsPercent"`
}

type WorldInvItem struct {
	Name   string `json:"Name"`
	Amount int    `json:"Amount"`
}

type CloudInvItem struct {
	Name      string `json:"Name"`
	ClassName string `json:"ClassName"`
	Amount    int    `json:"Amount"`
	MaxAmount int    `json:"MaxAmount"`
}

type SinkData struct {
	TotalPoints float64   `json:"TotalPoints"`
	NumCoupon   int       `json:"NumCoupon"`
	Percent     float64   `json:"Percent"`     // Towards next coupon
	GraphPoints []float64 `json:"GraphPoints"` // Points per minute history
}

type Player struct {
	Id        string       `json:"Id"` // Assuming ID is string
	Name      string       `json:"Name"`
	PlayerHP  float64      `json:"PlayerHP"`
	Location  Location     `json:"location"`
	Inventory []ItemAmount `json:"Inventory"`
}

type TrainTimeTableEntry struct {
	StationName string `json:"StationName"`
}

type TrainVehicle struct {
	Name           string       `json:"Name"`
	ClassName      string       `json:"ClassName"`
	TotalMass      float64      `json:"TotalMass"`
	PayloadMass    float64      `json:"PayloadMass"`
	MaxPayloadMass float64      `json:"MaxPayloadMass"`
	Inventory      []ItemAmount `json:"Inventory"`
}

type Train struct {
	ID             string                `json:"ID"`
	Name           string                `json:"Name"`
	ForwardSpeed   float64               `json:"ForwardSpeed"`
	Location       Location              `json:"location"`
	TimeTable      []TrainTimeTableEntry `json:"TimeTable"`
	TimeTableIndex int                   `json:"TimeTableIndex"`
	Status         string                `json:"Status"` // "Self-Driving", "Manual Driving", "Parked"
	Derailed       bool                  `json:"Derailed"`
	PowerInfo      PowerInfo             `json:"PowerInfo"`
	Vehicles       []TrainVehicle        `json:"Vehicles"`
}

// InventoryItem is used by train platforms, drone stations, and truck stations
type InventoryItem struct {
	Name      string  `json:"Name"`
	ClassName string  `json:"ClassName"`
	Amount    float64 `json:"Amount"`
	MaxAmount float64 `json:"MaxAmount"`
}

type TrainStationPlatform struct {
	ID            string          `json:"ID"`
	Name          string          `json:"Name"`
	ClassName     string          `json:"ClassName"`
	Location      Location        `json:"location"`
	BoundingBox   BoundingBox     `json:"BoundingBox"`
	LoadingMode   string          `json:"LoadingMode"`   // "Loading" or "Unloading"
	LoadingStatus string          `json:"LoadingStatus"` // "Idle", "Loading", or "Unloading"
	TransferRate  float64         `json:"TransferRate"`  // Solid items rate
	InflowRate    float64         `json:"InflowRate"`    // Fluid incoming rate
	OutflowRate   float64         `json:"OutflowRate"`   // Fluid outgoing rate
	Inventory     []InventoryItem `json:"Inventory"`
}

type TrainStation struct {
	Name           string                 `json:"Name"`
	Location       Location               `json:"location"`
	BoundingBox    BoundingBox            `json:"BoundingBox"`
	PowerInfo      PowerInfo              `json:"PowerInfo"`
	CargoInventory []TrainStationPlatform `json:"CargoInventory"`
}

type Drone struct {
	Name               string   `json:"Name"`
	Location           Location `json:"location"`
	FlyingSpeed        float64  `json:"FlyingSpeed"`
	HomeStation        string   `json:"HomeStation"`        // Name
	TargetStation      string   `json:"TargetStation"`      // Paired Station Name
	DestinationStation string   `json:"DestinationStation"` // Current flight target Name
}

type TruckFuel struct {
	FuelName  string  `json:"FuelName"`
	Amount    float64 `json:"Amount"`
	MaxAmount float64 `json:"MaxAmount"`
}

type Truck struct {
	ID           string       `json:"ID"`
	Name         string       `json:"Name"`
	ForwardSpeed float64      `json:"ForwardSpeed"`
	AutoPilot    bool         `json:"AutoPilot"`
	Fuel         []TruckFuel  `json:"Fuel"`
	Storage      []ItemAmount `json:"Storage"`
	Driver       string       `json:"Driver"` // Driver name
	Location     Location     `json:"location"`
}

type DroneStationFuel struct {
	FuelName string `json:"FuelName"` // Can be "N/A"
}

type DroneStation struct {
	Name            string           `json:"Name"`
	Location        Location         `json:"location"`
	BoundingBox     BoundingBox      `json:"BoundingBox"`
	PowerInfo       PowerInfo        `json:"PowerInfo"`
	ActiveFuel      DroneStationFuel `json:"ActiveFuel"`
	FuelInventory   []ItemAmount     `json:"FuelInventory"`
	AvgIncRate      float64          `json:"AvgIncRate"`      // Average incoming items/minute
	AvgOutRate      float64          `json:"AvgOutRate"`      // Average outgoing items/minute
	InputInventory  []InventoryItem  `json:"InputInventory"`  // Items being received
	OutputInventory []InventoryItem  `json:"OutputInventory"` // Items being sent
}

type TruckStation struct {
	Name            string          `json:"Name"`
	Location        Location        `json:"location"`
	BoundingBox     BoundingBox     `json:"BoundingBox"`
	PowerInfo       PowerInfo       `json:"PowerInfo"`
	TransferRate    float64         `json:"TransferRate"`    // Current transfer rate
	MaxTransferRate float64         `json:"MaxTransferRate"` // Max stacks/sec for all vehicles
	Inventory       []InventoryItem `json:"Inventory"`       // Station inventory
}

type Belt struct {
	ID             string     `json:"ID"`
	Name           string     `json:"Name"`
	ClassName      string     `json:"ClassName"`
	Location0      Location   `json:"location0"`
	Location1      Location   `json:"location1"`
	Connected0     bool       `json:"Connected0"`
	Connected1     bool       `json:"Connected1"`
	SplineData     []Location `json:"SplineData"`
	Length         float64    `json:"Length"`
	ItemsPerMinute float64    `json:"ItemsPerMinute"`
}

type Pipe struct {
	ID             string     `json:"ID"`
	Name           string     `json:"Name"`
	ClassName      string     `json:"ClassName"`
	Location0      Location   `json:"location0"`
	Location1      Location   `json:"location1"`
	Connected0     bool       `json:"Connected0"`
	Connected1     bool       `json:"Connected1"`
	SplineData     []Location `json:"SplineData"`
	Length         float64    `json:"Length"`
	ItemsPerMinute float64    `json:"ItemsPerMinute"`
}

type PipeJunction struct {
	ID        string   `json:"ID"`
	Name      string   `json:"Name"`
	ClassName string   `json:"ClassName"`
	Location  Location `json:"location"`
}

type TrainRail struct {
	ID         string     `json:"ID"`
	Name       string     `json:"Name"`
	ClassName  string     `json:"ClassName"`
	Location0  Location   `json:"location0"`
	Location1  Location   `json:"location1"`
	Connected0 bool       `json:"Connected0"`
	Connected1 bool       `json:"Connected1"`
	SplineData []Location `json:"SplineData"`
	Length     float64    `json:"Length"`
}

type SplitterMerger struct {
	ID          string      `json:"ID"`
	Name        string      `json:"Name"`
	ClassName   string      `json:"ClassName"`
	Location    Location    `json:"location"`
	BoundingBox BoundingBox `json:"BoundingBox"`
}

type Cable struct {
	ID         string   `json:"ID"`
	Name       string   `json:"Name"`
	ClassName  string   `json:"ClassName"`
	Location0  Location `json:"location0"`
	Location1  Location `json:"location1"`
	Connected0 bool     `json:"Connected0"`
	Connected1 bool     `json:"Connected1"`
	Length     float64  `json:"Length"`
}

type StorageInventoryItem struct {
	Name      string `json:"Name"`
	ClassName string `json:"ClassName"`
	Amount    int    `json:"Amount"`
	MaxAmount int    `json:"MaxAmount"`
}

type Storage struct {
	ID          string                 `json:"ID"`
	Name        string                 `json:"Name"`
	ClassName   string                 `json:"ClassName"`
	Location    Location               `json:"location"`
	BoundingBox BoundingBox            `json:"BoundingBox"`
	Inventory   []StorageInventoryItem `json:"Inventory"`
}

// Tractor has same structure as Truck
type Tractor struct {
	ID           string       `json:"ID"`
	Name         string       `json:"Name"`
	ForwardSpeed float64      `json:"ForwardSpeed"`
	AutoPilot    bool         `json:"AutoPilot"`
	Fuel         []TruckFuel  `json:"Fuel"`
	Storage      []ItemAmount `json:"Storage"`
	Driver       string       `json:"Driver"`
	Location     Location     `json:"location"`
}

// Explorer has same structure as Truck
type Explorer struct {
	ID           string       `json:"ID"`
	Name         string       `json:"Name"`
	ForwardSpeed float64      `json:"ForwardSpeed"`
	AutoPilot    bool         `json:"AutoPilot"`
	Fuel         []TruckFuel  `json:"Fuel"`
	Storage      []ItemAmount `json:"Storage"`
	Driver       string       `json:"Driver"`
	Location     Location     `json:"location"`
}

type VehiclePathVertex struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type VehiclePath struct {
	PathName    string              `json:"PathName"`
	VehicleType string              `json:"VehicleType"` // "Explorer", "Factory Cart", "Truck", "Tractor"
	PathLength  float64             `json:"PathLength"`  // in cm
	Vertices    []VehiclePathVertex `json:"Vertices"`
}

type SpaceElevatorPhase struct {
	Name      string  `json:"Name"`
	ClassName string  `json:"ClassName"`
	Amount    float64 `json:"Amount"`
	TotalCost float64 `json:"TotalCost"`
}

type SpaceElevator struct {
	ID            string               `json:"ID"`
	Name          string               `json:"Name"`
	ClassName     string               `json:"ClassName"`
	Location      Location             `json:"location"`
	BoundingBox   BoundingBox          `json:"BoundingBox"`
	CurrentPhase  []SpaceElevatorPhase `json:"CurrentPhase"`
	FullyUpgraded bool                 `json:"FullyUpgraded"`
	UpgradeReady  bool                 `json:"UpgradeReady"`
}

// ScannedResourceNode is used by radar towers (from /getRadarTower)
type ScannedResourceNode struct {
	ID           string   `json:"ID"`
	Name         string   `json:"Name"`
	ClassName    string   `json:"ClassName"`
	Purity       string   `json:"Purity"`
	ResourceForm string   `json:"ResourceForm"`
	NodeType     string   `json:"NodeType"` // This is the resource type (IronOre, Coal, etc.) in radar context
	Exploited    bool     `json:"Exploited"`
	Location     Location `json:"location"`
}

// ResourceNode is used by the world resource nodes (from /getResourceNode)
type ResourceNode struct {
	ID           string   `json:"ID"`
	Name         string   `json:"Name"`
	ClassName    string   `json:"ClassName"`
	Purity       string   `json:"Purity"`       // "Impure", "Normal", "Pure"
	EnumPurity   string   `json:"EnumPurity"`   // "RP_Impure", etc.
	ResourceForm string   `json:"ResourceForm"` // "Solid", "Liquid", "Gas", etc.
	NodeType     string   `json:"NodeType"`     // "Node", "Geyser", "Fracking Core", "Fracking Satellite"
	Exploited    bool     `json:"Exploited"`
	Location     Location `json:"location"`
}

type ScannedFauna struct {
	Name      string `json:"Name"`
	ClassName string `json:"ClassName"`
	Amount    int    `json:"Amount"`
}

type ScannedFlora struct {
	Name      string `json:"Name"`
	ClassName string `json:"ClassName"`
	Amount    int    `json:"Amount"`
}

type ScannedSignal struct {
	Name      string `json:"Name"`
	ClassName string `json:"ClassName"`
	Amount    int    `json:"Amount"`
}

type RadarTower struct {
	ID           string                `json:"ID"`
	Location     Location              `json:"location"`
	BoundingBox  BoundingBox           `json:"BoundingBox"`
	RevealRadius float64               `json:"RevealRadius"`
	Nodes        []ScannedResourceNode `json:"ScannedResourceNodes"`
	Fauna        []ScannedFauna        `json:"Fauna"`
	Flora        []ScannedFlora        `json:"Flora"`
	Signal       []ScannedSignal       `json:"Signal"`
}

type Hypertube struct {
	ID          string      `json:"ID"`
	Name        string      `json:"Name"`
	ClassName   string      `json:"ClassName"`
	Location0   Location    `json:"location0"`
	Location1   Location    `json:"location1"`
	Connected0  bool        `json:"Connected0"`
	Connected1  bool        `json:"Connected1"`
	Length      float64     `json:"Length"`
	SplineData  []Location  `json:"SplineData"`
	BoundingBox BoundingBox `json:"BoundingBox"`
}

type HypertubeEntrance struct {
	ID          string      `json:"ID"`
	Name        string      `json:"Name"`
	ClassName   string      `json:"ClassName"`
	Location    Location    `json:"location"`
	BoundingBox BoundingBox `json:"BoundingBox"`
	PowerInfo   PowerInfo   `json:"PowerInfo"`
}

// HubTerminalCostItem represents an item required for milestone completion
type HubTerminalCostItem struct {
	Name          string  `json:"Name"`
	ClassName     string  `json:"ClassName"`
	Amount        float64 `json:"Amount"` // Amount submitted so far
	MaxAmount     float64 `json:"MaxAmount"`
	RemainingCost float64 `json:"RemainingCost"` // How much left to submit
	TotalCost     float64 `json:"TotalCost"`     // Total required
}

// HubTerminalMilestone represents the active milestone
type HubTerminalMilestone struct {
	ID        string                `json:"ID"`
	Name      string                `json:"Name"`
	ClassName string                `json:"ClassName"`
	TechTier  int                   `json:"TechTier"`
	Type      string                `json:"Type"` // "Milestone" or "No Milestone Selected"
	Cost      []HubTerminalCostItem `json:"Cost"`
}

// HubTerminal is the FRM API response structure for /getHubTerminal
type HubTerminal struct {
	ID                 string               `json:"ID"`
	Name               string               `json:"Name"`
	ClassName          string               `json:"ClassName"`
	Location           Location             `json:"location"`
	BoundingBox        BoundingBox          `json:"BoundingBox"`
	HasActiveMilestone bool                 `json:"HasActiveMilestone"`
	ActiveMilestone    HubTerminalMilestone `json:"ActiveMilestone"`
	ShipDock           bool                 `json:"ShipDock"`   // Is ship docked?
	ShipReturn         string               `json:"ShipReturn"` // "00:00:00" format
	SchName            string               `json:"SchName"`    // Schematic name
}

type SchematicCost struct {
	Name      string  `json:"Name"`
	ClassName string  `json:"ClassName"`
	Amount    float64 `json:"Amount"`
	TotalCost float64 `json:"TotalCost"`
}

type Schematic struct {
	Recipes     []PlannerRecipe `json:"Recipes"`
	ID          string          `json:"ID"`
	Name        string          `json:"Name"`
	TechTier    int             `json:"TechTier"`
	Type        string          `json:"Type"`
	Purchased   bool            `json:"Purchased"`
	Locked      bool            `json:"Locked"`
	LockedPhase bool            `json:"LockedPhase"`
	Cost        []SchematicCost `json:"Cost"`
}
