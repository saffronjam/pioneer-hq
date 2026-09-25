package graph

import (
	"api/internal/planner"
	"context"
)

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
