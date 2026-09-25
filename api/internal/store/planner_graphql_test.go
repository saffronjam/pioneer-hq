package store_test

import (
	"api/pkg/eventbus"
	"bytes"
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"api/internal/auth"
	"api/internal/graph"
	"api/internal/planner"
	"github.com/99designs/gqlgen/graphql/handler"
)

func TestPlannerGraphQLContract(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	server := handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Planner: planner.NewService(st)}, Directives: graph.DirectiveRoot{Auth: graph.AuthDirective}}))
	request := func(query string, variables map[string]any, authorized bool) map[string]json.RawMessage {
		body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/graphql", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if authorized {
			req = req.WithContext(auth.WithUser(ctx, auth.Caller{}))
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, req)
		var result map[string]json.RawMessage
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(response.Body.String())
		}
		return result
	}
	query := `query { plannerWorkspace(sessionId:"sess-1",calculate:true) { catalog { recipes { id } } diagrams { id revision document { nodes { id generated } } } calculations { nodes { machines } } } }`
	if result := request(query, nil, false); result["errors"] == nil {
		t.Fatal("planner query is unguarded")
	}
	doc := planner.Document{Version: 1, Name: "GraphQL factory", Viewport: planner.Viewport{Zoom: 1}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}, Connections: []planner.Connection{}, Nodes: []planner.Node{{ID: "out", Kind: "output", ItemID: "Desc_IronRod_C", Name: "Rods", Rate: 48, Clock: 100, Status: "planned", Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}}}}
	save := `mutation($document:PlannerDocumentInput!) { savePlannerDiagram(sessionId:"sess-1",id:"",expectedRevision:0,document:$document,expand:true) { id revision document { nodes { id kind } } } }`
	result := request(save, map[string]any{"document": doc}, true)
	if result["errors"] != nil {
		t.Fatal(string(result["errors"]))
	}
	result = request(query, nil, true)
	if result["errors"] != nil {
		t.Fatal(string(result["errors"]))
	}
	var data struct {
		Workspace struct {
			Catalog  struct{ Recipes []struct{ ID string } } `json:"catalog"`
			Diagrams []struct {
				ID       string
				Revision int
			}
			Calculations []struct{ Nodes []struct{ Machines int } }
		} `json:"plannerWorkspace"`
	}
	if err := json.Unmarshal(result["data"], &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Workspace.Catalog.Recipes) != 291 || len(data.Workspace.Diagrams) != 1 || data.Workspace.Diagrams[0].Revision != 1 {
		t.Fatal(string(result["data"]))
	}
	found := false
	for _, n := range data.Workspace.Calculations[0].Nodes {
		if n.Machines == 4 {
			found = true
		}
	}
	if !found {
		t.Fatal("missing four-constructor plan")
	}
}

func TestPlannerSubscriptionAfterDurableSave(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	bus := eventbus.NewChannelBus()
	service := planner.NewService(st)
	service.OnChange = func(sid string) {
		bus.Publish(eventbus.Event{Kind: eventbus.KindSatisfactory, SessionID: sid, DataType: "planner"})
	}
	handler := handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Planner: service, EventBus: bus}, Directives: graph.DirectiveRoot{Auth: graph.AuthDirective}}))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), auth.Caller{})))
	}))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"graphql-transport-ws"}}
	conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	write := func(value any) {
		t.Helper()
		if err := conn.WriteJSON(value); err != nil {
			t.Fatal(err)
		}
	}
	read := func() map[string]json.RawMessage {
		t.Helper()
		var value map[string]json.RawMessage
		if err := conn.ReadJSON(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	write(map[string]any{"type": "connection_init"})
	if string(read()["type"]) != `"connection_ack"` {
		t.Fatal("missing websocket acknowledgement")
	}
	write(map[string]any{"id": "p", "type": "subscribe", "payload": map[string]any{"query": `subscription { plannerWorkspaceChanged(sessionId:"sess-1") { revision catalogVersion diagrams { id revision } } }`}})
	initial := read()
	if string(initial["type"]) != `"next"` {
		t.Fatal("missing initial workspace", initial)
	}
	doc := planner.Document{Version: 1, Name: "Subscribed", Viewport: planner.Viewport{Zoom: 1}}
	saved, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	updated := read()
	if !bytes.Contains(updated["payload"], []byte(saved.ID)) {
		t.Fatal("notification did not contain saved document", string(updated["payload"]))
	}
}
