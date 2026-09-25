package worker

import (
	"context"
	"testing"
)

func TestPlannerWritesRequireCurrentConfirmedPublisher(t *testing.T) {
	sm := NewSessionManager(nil, nil)
	current := &publisherState{saveName: "pinned", saveConfirmed: true}
	sm.publishers["s"] = current
	writes := 0
	write := func() { writes++ }
	ctx, cancel := context.WithCancel(context.Background())
	sm.withPlannerSession(ctx, "s", current, write)
	if writes != 1 {
		t.Fatal("current confirmed publisher cannot save")
	}
	current.InvalidateSave()
	sm.withPlannerSession(ctx, "s", current, write)
	current.ConfirmSave()
	current.SetDisconnected(true)
	sm.withPlannerSession(ctx, "s", current, write)
	current.SetDisconnected(false)
	sm.withPlannerSession(ctx, "s", &publisherState{saveConfirmed: true}, write)
	cancel()
	sm.withPlannerSession(ctx, "s", current, write)
	delete(sm.publishers, "s")
	sm.withPlannerSession(context.Background(), "s", current, write)
	if writes != 1 {
		t.Fatal("stale, canceled, paused, or unconfirmed publisher saved a catalog")
	}
}
