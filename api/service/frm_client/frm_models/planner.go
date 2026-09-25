package frm_models

// PlannerItem contains FRM's already-normalized recipe quantities.
type PlannerItem struct {
	ClassName   string
	Amount      float64
	FactoryRate float64
}

// PlannerRecipe describes an FRM recipe and its factory producers.
type PlannerRecipe struct {
	ClassName       string
	Name            string
	FactoryDuration float64
	ProducedIn      []string
	Ingredients     []PlannerItem
	Products        []PlannerItem
}

// PlannerSchematic maps a save's schematic unlocks to recipes.
type PlannerSchematic struct {
	Type      string
	Purchased bool
	Recipes   []PlannerRecipe
}
