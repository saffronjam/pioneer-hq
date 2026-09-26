package graph

import (
	"api/internal/graph/model"
	"api/internal/planner"
	"context"
)

// ExportPlannerDiagram returns a portable JSON plan file.
func (r *queryResolver) ExportPlannerDiagram(ctx context.Context, sessionID, id string) (string, error) {
	return r.Planner.Export(ctx, sessionID, id)
}

// ValidatePlannerImport previews a file without creating a plan.
func (r *queryResolver) ValidatePlannerImport(ctx context.Context, sessionID, data string) (*model.PlannerImportPreview, error) {
	diagrams, root, err := r.Planner.ValidateImport(ctx, sessionID, data)
	if err != nil {
		return nil, err
	}
	preview := &model.PlannerImportPreview{DiagramCount: len(diagrams)}
	for _, d := range diagrams {
		preview.NodeCount += len(d.Document.Nodes)
		if d.ID == root {
			preview.Name = d.Document.Name
		}
	}
	return preview, nil
}

// ImportPlannerDiagram creates a plan from a validated JSON bundle.
func (r *mutationResolver) ImportPlannerDiagram(ctx context.Context, sessionID, name, data string) (*planner.Diagram, error) {
	return r.Planner.Import(ctx, sessionID, name, data)
}

// DuplicatePlannerDiagram creates an independent named copy.
func (r *mutationResolver) DuplicatePlannerDiagram(ctx context.Context, sessionID, id, name string) (*planner.Diagram, error) {
	return r.Planner.Duplicate(ctx, sessionID, id, name)
}

// PlannerWorkspace reads a session's persistent production plans.
func (r *queryResolver) PlannerWorkspace(ctx context.Context, sessionID string, calculate bool) (*planner.Workspace, error) {
	return r.Planner.Load(ctx, sessionID, calculate)
}

// SavePlannerDiagram saves an authored document and optional backward expansion.
func (r *mutationResolver) SavePlannerDiagram(ctx context.Context, sessionID, id string, expectedRevision int, document planner.Document, expand bool) (*planner.Diagram, error) {
	return r.Planner.Save(ctx, sessionID, id, expectedRevision, document, expand)
}

// DeletePlannerDiagram deletes an unreferenced factory at the expected revision.
func (r *mutationResolver) DeletePlannerDiagram(ctx context.Context, sessionID, id string, expectedRevision int) (bool, error) {
	err := r.Planner.Delete(ctx, sessionID, id, expectedRevision)
	return err == nil, err
}

// PlannerWorkspaceChanged streams durable planner revision notifications.
func (r *subscriptionResolver) PlannerWorkspaceChanged(ctx context.Context, sessionID string) (<-chan *planner.Change, error) {
	ch := r.EventBus.SubscribeDomain(sessionID, "planner")
	initial, err := r.Planner.Revision(ctx, sessionID)
	if err != nil {
		r.EventBus.Unsubscribe(ch)
		return nil, err
	}
	out := make(chan *planner.Change, 1)
	out <- initial
	go func() {
		defer close(out)
		defer r.EventBus.Unsubscribe(ch)
		for {
			select {
			case <-ctx.Done():
				return
			case _, ok := <-ch:
				if !ok {
					return
				}
				value, err := r.Planner.Revision(ctx, sessionID)
				if err != nil {
					return
				}
				select {
				case out <- value:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return out, nil
}

// PreviewPlannerDiagram calculates an edited plan without saving it.
func (r *queryResolver) PreviewPlannerDiagram(ctx context.Context, sessionID, id string, document planner.Document) (*planner.Workspace, error) {
	return r.Planner.Preview(ctx, sessionID, id, document)
}
