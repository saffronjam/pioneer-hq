// Package planner models and calculates session-owned production diagrams.
package planner

import "time"

// Amount is a material quantity per recipe cycle.
type Amount struct {
	ItemID string  `json:"itemId"`
	Amount float64 `json:"amount"`
}

// Item describes a material and its transport form.
type Item struct {
	Unavailable  bool   `json:"unavailable"`
	Observed     bool   `json:"observed,omitempty"`
	MissingCount int    `json:"missingCount,omitempty"`
	ID           string `json:"id"`
	Name         string `json:"name"`
	Form         string `json:"form"`
	Resource     bool   `json:"resource"`
	Sinkable     bool   `json:"sinkable"`
}

// Machine contains the equipment coefficients used by the planner.
type Machine struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Power              float64 `json:"power"`
	PowerExponent      float64 `json:"powerExponent"`
	BoostPowerExponent float64 `json:"boostPowerExponent"`
	BoostSlots         int     `json:"boostSlots"`
	BoostPerSlot       float64 `json:"boostPerSlot"`
	VariablePower      bool    `json:"variablePower"`
	MinClock           float64 `json:"minClock"`
	MaxClock           float64 `json:"maxClock"`
}

// Recipe describes one automated transformation.
type Recipe struct {
	Unavailable   bool     `json:"unavailable"`
	MissingCount  int      `json:"missingCount,omitempty"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Alternate     bool     `json:"alternate"`
	Duration      float64  `json:"duration"`
	MachineIDs    []string `json:"machineIds"`
	Ingredients   []Amount `json:"ingredients"`
	Products      []Amount `json:"products"`
	PowerConstant float64  `json:"powerConstant"`
	PowerFactor   float64  `json:"powerFactor"`
}

// Unlock records a session's cached recipe availability.
type Unlock struct {
	RecipeID string `json:"recipeId"`
	Unlocked bool   `json:"unlocked"`
}

// Catalog is a complete, versioned input to production calculations.
type Catalog struct {
	SyncError     string    `json:"syncError"`
	ObservedItems []string  `json:"observedItems,omitempty"`
	Version       string    `json:"version"`
	SourceHash    string    `json:"sourceHash"`
	Items         []Item    `json:"items"`
	Machines      []Machine `json:"machines"`
	Recipes       []Recipe  `json:"recipes"`
	Belts         []float64 `json:"belts"`
	Pipes         []float64 `json:"pipes"`
	Unlocks       []Unlock  `json:"unlocks"`
}

// RecipeChoice chooses a product's recipe in a scope.
type RecipeChoice struct {
	ItemID   string `json:"itemId"`
	RecipeID string `json:"recipeId"`
}

// Settings contains explicit overrides; zero transport tiers inherit.
type Settings struct {
	Recipes  []RecipeChoice `json:"recipes"`
	BeltTier int            `json:"beltTier"`
	PipeTier int            `json:"pipeTier"`
}

// Node is an authored production group, source, boundary, target, section, or link.
type Node struct {
	ID               string   `json:"id"`
	Kind             string   `json:"kind"`
	ParentID         string   `json:"parentId"`
	Name             string   `json:"name"`
	ItemID           string   `json:"itemId"`
	RecipeID         string   `json:"recipeId"`
	MachineID        string   `json:"machineId"`
	LinkedDiagramID  string   `json:"linkedDiagramId"`
	X                float64  `json:"x"`
	Y                float64  `json:"y"`
	Width            float64  `json:"width"`
	Height           float64  `json:"height"`
	Collapsed        bool     `json:"collapsed"`
	Rate             float64  `json:"rate"`
	Clock            float64  `json:"clock"`
	Somersloops      int      `json:"somersloops"`
	Status           string   `json:"status"`
	Generated        bool     `json:"generated"`
	FixedSupply      bool     `json:"fixedSupply"`
	Settings         Settings `json:"settings"`
	BuiltFingerprint string   `json:"builtFingerprint"`
}

// Connection carries aggregate material between two ports.
type Connection struct {
	ID             string `json:"id"`
	Source         string `json:"source"`
	Target         string `json:"target"`
	SourcePort     string `json:"sourcePort"`
	TargetPort     string `json:"targetPort"`
	ItemID         string `json:"itemId"`
	AvailableLines *int   `json:"availableLines,omitempty"`
}

// Viewport stores the editor's camera.
type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// Document is the persistent editable diagram content.
type Document struct {
	Version        int          `json:"version"`
	Name           string       `json:"name"`
	Description    string       `json:"description"`
	Settings       Settings     `json:"settings"`
	Nodes          []Node       `json:"nodes"`
	Connections    []Connection `json:"connections"`
	Viewport       Viewport     `json:"viewport"`
	CatalogVersion string       `json:"catalogVersion"`
}

// Diagram wraps a document with its ownership and optimistic revision.
type Diagram struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Revision  int       `json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
	Document  Document  `json:"document"`
}

// Flow is a material rate at a port.
type Flow struct {
	ItemID string  `json:"itemId"`
	Rate   float64 `json:"rate"`
}

// Diagnostic identifies a shortage or configuration problem without changing the target.
type Diagnostic struct {
	DiagramID    string  `json:"diagramId"`
	NodeID       string  `json:"nodeId"`
	ConnectionID string  `json:"connectionId"`
	Code         string  `json:"code"`
	Message      string  `json:"message"`
	ItemID       string  `json:"itemId"`
	Rate         float64 `json:"rate"`
}

// NodeResult describes planned activity and installed capacity.
type NodeResult struct {
	NodeID             string  `json:"nodeId"`
	Machines           int     `json:"machines"`
	EquivalentMachines float64 `json:"equivalentMachines"`
	Utilization        float64 `json:"utilization"`
	Somersloops        int     `json:"somersloops"`
	PowerKnown         bool    `json:"powerKnown"`
	PowerMin           float64 `json:"powerMin"`
	PowerMax           float64 `json:"powerMax"`
	InstalledPowerMax  float64 `json:"installedPowerMax"`
	Inputs             []Flow  `json:"inputs"`
	Outputs            []Flow  `json:"outputs"`
	Fingerprint        string  `json:"fingerprint"`
}

// ConnectionResult describes throughput and inherited transport capacity.
type ConnectionResult struct {
	ConnectionID  string  `json:"connectionId"`
	Rate          float64 `json:"rate"`
	Tier          int     `json:"tier"`
	Capacity      float64 `json:"capacity"`
	RequiredLines int     `json:"requiredLines"`
	ScopeID       string  `json:"scopeId"`
}

// Calculation is a result for a consistent set of session diagrams.
type Calculation struct {
	Resolved          bool               `json:"resolved"`
	DiagramID         string             `json:"diagramId"`
	Revision          int                `json:"revision"`
	CatalogVersion    string             `json:"catalogVersion"`
	WorkspaceRevision string             `json:"workspaceRevision"`
	Nodes             []NodeResult       `json:"nodes"`
	Connections       []ConnectionResult `json:"connections"`
	Diagnostics       []Diagnostic       `json:"diagnostics"`
}

// Workspace is the session's authoritative planner snapshot.
type Workspace struct {
	Revision     string        `json:"revision"`
	Catalog      Catalog       `json:"catalog"`
	Diagrams     []Diagram     `json:"diagrams"`
	Calculations []Calculation `json:"calculations"`
}
