package worker

import (
	"api/internal/planner"
	"api/models/models"
	"api/pkg/eventbus"
	"context"
	"log/slog"
	"time"
)

// SetPlanner attaches the durable planner before starting session publishers.
func (sm *SessionManager) SetPlanner(service *planner.Service) {
	sm.planner = service
	service.OnChange = sm.plannerChanged
}

func (sm *SessionManager) plannerChanged(sid string) {
	if sm.bus != nil {
		sm.bus.Publish(eventbus.Event{Kind: eventbus.KindSatisfactory, SessionID: sid, DataType: "planner", Payload: eventbus.SatisfactoryEvent{SessionID: sid, DataType: "planner"}})
	}
}

func (sm *SessionManager) withPlannerSession(ctx context.Context, sid string, state *publisherState, fn func()) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if ctx.Err() == nil && sm.publishers[sid] == state && state.SaveConfirmed() && !state.IsDisconnected() {
		fn()
	}
}

type plannerClient interface {
	GetSessionInfo(context.Context) (*models.SessionInfo, error)
	GetPlannerCatalog(context.Context) (planner.Catalog, error)
	PlannerUnlocks() []planner.Unlock
}

func (sm *SessionManager) syncPlanner(ctx context.Context, sess *models.Session, state *publisherState, client plannerClient) {
	sync := func() {
		if !state.SaveConfirmed() || ctx.Err() != nil {
			return
		}
		fetchCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		before, err := client.GetSessionInfo(fetchCtx)
		if err != nil || before == nil || before.SaveName != sess.SaveName {
			return
		}
		catalog, err := client.GetPlannerCatalog(fetchCtx)
		if err != nil {
			sm.withPlannerSession(ctx, sess.ID, state, func() {
				slog.Warn("Planner recipe sync failed", "session", sess.ID, "error", err)
				sm.planner.SyncFailure(ctx, sess.ID, "Recipe sync unavailable. Using cached recipes.")
			})
			return
		}
		after, err := client.GetSessionInfo(fetchCtx)
		if err != nil || after == nil || after.SaveName != sess.SaveName {
			return
		}
		sm.withPlannerSession(ctx, sess.ID, state, func() {
			if err := sm.planner.Sync(ctx, sess.ID, catalog); err != nil {
				slog.Warn("Planner recipe sync failed", "session", sess.ID, "error", err)
				sm.planner.SyncFailure(ctx, sess.ID, "Recipe sync unavailable. Using cached recipes.")
			}
		})
	}
	for !state.SaveConfirmed() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
	sync()
	tick := time.NewTicker(120 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			sync()
		}
	}
}
