package planner

import (
	"context"
	"math"
	"testing"
)

func testDocument() Document {
	return Document{Version: 1, Name: "Test", Settings: Settings{BeltTier: 1, PipeTier: 1}, Viewport: Viewport{Zoom: 1}, Nodes: []Node{}, Connections: []Connection{}}
}
func testNode(id, kind, item string, rate float64) Node {
	return Node{ID: id, Kind: kind, Name: id, ItemID: item, Rate: rate, Clock: 100, Status: "planned"}
}
func near(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-4 {
		t.Fatalf("got %.8f want %.8f", got, want)
	}
}

func TestIronPlateChain(t *testing.T) {
	c := BundledCatalog()
	if _, err := NewIndex(c); err != nil {
		t.Fatal(err)
	}
	d := testDocument()
	d.Nodes = append(d.Nodes, testNode("plates", "output", "Desc_IronPlate_C", 60), testNode("ore", "supply", "Desc_OreIron_C", 80))
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", SessionID: "s", Document: d}}, "r")
	if err != nil {
		t.Fatal(err)
	}
	nodes := nodeMap(d)
	for _, r := range results[0].Nodes {
		switch nodes[r.NodeID].RecipeID {
		case "Recipe_IronPlate_C", "Recipe_IngotIron_C":
			near(t, r.EquivalentMachines, 3)
			if r.Machines != 3 {
				t.Fatal(r)
			}
		}
	}
	found := false
	for _, diag := range results[0].Diagnostics {
		if diag.Code == "supply_shortage" {
			near(t, diag.Rate, 10)
			found = true
		}
	}
	if !found {
		t.Fatal("missing supply shortage")
	}
}

func TestFractionalMachinesAndBoost(t *testing.T) {
	c := BundledCatalog()
	d := testDocument()
	d.Nodes = append(d.Nodes, testNode("rods", "output", "Desc_IronRod_C", 48))
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	r, err := Calculate(context.Background(), c, []Diagram{{ID: "d", SessionID: "s", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range r[0].Nodes {
		if nodeMap(d)[n.NodeID].RecipeID == "Recipe_IronRod_C" {
			near(t, n.EquivalentMachines, 3.2)
			near(t, n.Utilization, .8)
			if n.Machines != 4 {
				t.Fatal(n)
			}
		}
	}
	for i := range d.Nodes {
		if d.Nodes[i].RecipeID == "Recipe_IronRod_C" {
			d.Nodes[i].Somersloops = 1
		}
	}
	r, err = Calculate(context.Background(), c, []Diagram{{ID: "d", SessionID: "s", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range r[0].Nodes {
		if nodeMap(d)[n.NodeID].RecipeID == "Recipe_IronRod_C" {
			near(t, n.EquivalentMachines, 1.6)
			near(t, n.Inputs[0].Rate, 24)
			near(t, n.Outputs[0].Rate, 48)
			near(t, n.InstalledPowerMax, 32)
		}
	}
}

func TestInheritanceAndTransportScope(t *testing.T) {
	d := testDocument()
	outer := testNode("outer", "group", "", 0)
	outer.Settings.BeltTier = 4
	inner := testNode("inner", "group", "", 0)
	inner.ParentID = "outer"
	inner.Settings.PipeTier = 2
	a := testNode("a", "supply", "Desc_IronOre_C", 10)
	a.ParentID = "inner"
	b := a
	b.ID = "b"
	b.ParentID = "outer"
	d.Nodes = []Node{outer, inner, a, b}
	settings := EffectiveSettings(d, "inner")
	if settings.BeltTier != 4 || settings.PipeTier != 2 {
		t.Fatal(settings)
	}
	if ConnectionScope(d, "a", "b") != "outer" {
		t.Fatal("wrong enclosing scope")
	}
}

func TestSharedFactoryCapacity(t *testing.T) {
	c := BundledCatalog()
	child := testDocument()
	child.Nodes = []Node{testNode("export", "output", "Desc_IronRod_C", 60)}
	child.Nodes[0].Exposed = true
	child, err := Expand(child, c)
	if err != nil {
		t.Fatal(err)
	}
	for i := range child.Nodes {
		child.Nodes[i].ParentID = "section"
	}
	child.Nodes = append(child.Nodes, testNode("section", "group", "", 0))
	ds := []Diagram{{ID: "child", SessionID: "s", Document: child}}
	for _, id := range []string{"parent-a", "parent-b"} {
		d := testDocument()
		link := testNode("link", "link", "", 0)
		link.LinkedDiagramID = "child"
		d.Nodes = []Node{link, testNode("target", "output", "Desc_IronRod_C", 40)}
		d.Connections = []Connection{{ID: "use", Source: "link", SourcePort: "export", Target: "target", ItemID: "Desc_IronRod_C"}}
		ds = append(ds, Diagram{ID: id, SessionID: "s", Document: d})
	}
	rs, err := Calculate(context.Background(), c, ds, "")
	if err != nil {
		t.Fatal(err)
	}
	var rods, ore, over float64
	for _, r := range rs[0].Nodes {
		n := nodeMap(child)[r.NodeID]
		if n.RecipeID == "Recipe_IronRod_C" {
			rods = r.EquivalentMachines
		}
		if n.Kind == "input" {
			ore += r.Outputs[0].Rate
		}
	}
	for _, d := range rs[0].Diagnostics {
		if d.Code == "overallocated" {
			over += d.Rate
		}
	}
	near(t, rods, 4)
	near(t, ore, 60)
	near(t, over, 20)
	for _, r := range rs[1:] {
		if len(r.Diagnostics) == 0 {
			t.Fatal("shared shortage was not propagated")
		}
	}
}

func TestMaterialRecyclingAndTransport(t *testing.T) {
	c := Catalog{Version: "test", Items: []Item{{ID: "raw", Form: "solid", Resource: true}, {ID: "product", Form: "solid"}}, Machines: []Machine{{ID: "m", MinClock: 1, MaxClock: 250, Power: 4, PowerExponent: 1}}, Recipes: []Recipe{{ID: "recycle", Duration: 60, MachineIDs: []string{"m"}, Ingredients: []Amount{{"raw", 2}, {"product", 1}}, Products: []Amount{{"product", 3}}}}, Belts: []float64{60, 120, 270, 480, 780, 1200}, Pipes: []float64{300, 600}}
	d := testDocument()
	n := testNode("machine", "production", "product", 0)
	n.RecipeID = "recycle"
	n.MachineID = "m"
	d.Nodes = []Node{n, testNode("source", "supply", "raw", 100), testNode("target", "output", "product", 100)}
	lines := 1
	d.Connections = []Connection{{ID: "in", Source: "source", Target: "machine", ItemID: "raw"}, {ID: "loop", Source: "machine", Target: "machine", ItemID: "product"}, {ID: "out", Source: "machine", Target: "target", ItemID: "product", AvailableLines: &lines}}
	rs, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	near(t, rs[0].Nodes[0].EquivalentMachines, 50)
	for _, r := range rs[0].Connections {
		if r.ConnectionID == "loop" {
			near(t, r.Rate, 50)
		}
		if r.ConnectionID == "out" && r.RequiredLines != 2 {
			t.Fatal(r)
		}
	}
	if len(rs[0].Diagnostics) != 1 || rs[0].Diagnostics[0].Code != "transport_shortage" {
		t.Fatal(rs[0].Diagnostics)
	}
}

func TestNestedGroupFingerprint(t *testing.T) {
	c := BundledCatalog()
	d := testDocument()
	g := testNode("g", "group", "", 0)
	target := testNode("target", "output", "Desc_IronRod_C", 30)
	target.ParentID = "g"
	d.Nodes = []Node{g, target}
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	calc := func() []Calculation {
		r, e := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	r := calc()
	for i := range d.Nodes {
		for _, nr := range r[0].Nodes {
			if nr.NodeID == d.Nodes[i].ID {
				d.Nodes[i].Status = "built"
				d.Nodes[i].BuiltFingerprint = nr.Fingerprint
			}
		}
		d.Nodes[i].X += 100
	}
	for _, diag := range calc()[0].Diagnostics {
		if diag.Code == "built_changed" {
			t.Fatal("layout changed build status")
		}
	}
	d.Nodes[1].Rate = 60
	found := false
	for _, diag := range calc()[0].Diagnostics {
		if diag.Code == "built_changed" && diag.NodeID == "g" {
			found = true
		}
	}
	if !found {
		t.Fatal("group did not detect descendant change")
	}
}

func TestLateGameRecipesAndAmbiguousBoundary(t *testing.T) {
	c := BundledCatalog()
	for _, r := range c.Recipes {
		if r.Name == "Dark Matter Crystal" || r.Name == "Dark Matter Residue" || r.Name == "Ficsite Ingot (Caterium)" {
			d := testDocument()
			d.Settings.Recipes = []RecipeChoice{{ItemID: r.Products[0].ItemID, RecipeID: r.ID}}
			d.Nodes = []Node{testNode("out", "output", r.Products[0].ItemID, 10)}
			d, err := Expand(d, c)
			if err != nil {
				t.Fatal(r.Name, err)
			}
			if _, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, ""); err != nil {
				t.Fatal(r.Name, err)
			}
		}
	}
}

func TestEveryCatalogRecipeExpandsAndBalances(t *testing.T) {
	c := BundledCatalog()
	for _, recipe := range c.Recipes {
		t.Run(recipe.ID, func(t *testing.T) {
			d := testDocument()
			d.Settings.Recipes = []RecipeChoice{{ItemID: recipe.Products[0].ItemID, RecipeID: recipe.ID}}
			d.Nodes = []Node{testNode("out", "output", recipe.Products[0].ItemID, 1)}
			d, err := Expand(d, c)
			if err != nil {
				t.Fatal(err)
			}
			results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range results[0].Nodes {
				if r.NodeID == "out" {
					near(t, r.Inputs[0].Rate, 1)
				}
			}
		})
	}
}
