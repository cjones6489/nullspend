import json

import httpx
import pytest
import respx

from nullspend import NullSpend, NullSpendError, PollTimeoutError, TimeoutError, RejectedError
from nullspend.types import (
    CostEventInput,
    CreateActionInput,
    ListCostEventsOptions,
    MarkResultInput,
)

BASE = "https://nullspend.test"


@pytest.fixture
def ns():
    client = NullSpend(base_url=BASE, api_key="ns_test_key")
    yield client
    client.close()


class TestConfig:
    def test_requires_base_url(self):
        with pytest.raises(NullSpendError, match="base_url is required"):
            NullSpend(base_url="", api_key="key")

    def test_requires_api_key(self):
        with pytest.raises(NullSpendError, match="api_key is required"):
            NullSpend(base_url="https://example.com", api_key="")

    def test_strips_trailing_slash(self):
        client = NullSpend(base_url="https://example.com///", api_key="key")
        assert client._base_url == "https://example.com"
        client.close()


class TestReportCost:
    @respx.mock
    def test_report_cost_success(self, ns):
        respx.post(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(
                201,
                json={"id": "ns_evt_123", "createdAt": "2026-03-27T00:00:00Z"},
            )
        )

        result = ns.report_cost(CostEventInput(
            provider="openai",
            model="gpt-4o",
            input_tokens=100,
            output_tokens=50,
            cost_microdollars=1500,
        ))

        assert result["id"] == "ns_evt_123"
        req = respx.calls[0].request
        assert req.headers["x-nullspend-key"] == "ns_test_key"
        assert req.headers["nullspend-version"] == "2026-04-01"
        body = json.loads(req.content)
        assert body["provider"] == "openai"
        assert body["inputTokens"] == 100

    @respx.mock
    def test_report_cost_with_session_and_tags(self, ns):
        respx.post(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(201, json={"id": "evt_1", "createdAt": "2026-03-27T00:00:00Z"})
        )

        ns.report_cost(CostEventInput(
            provider="anthropic",
            model="claude-sonnet-4-5",
            input_tokens=500,
            output_tokens=200,
            cost_microdollars=3000,
            session_id="session-abc",
            tags={"env": "prod", "team": "ml"},
        ))

        body = json.loads(respx.calls[0].request.content)
        assert body["sessionId"] == "session-abc"
        assert body["tags"] == {"env": "prod", "team": "ml"}

    @respx.mock
    def test_report_cost_batch(self, ns):
        respx.post(f"{BASE}/api/cost-events/batch").mock(
            return_value=httpx.Response(201, json={"inserted": 2, "ids": ["a", "b"]})
        )

        result = ns.report_cost_batch([
            CostEventInput(provider="openai", model="gpt-4o", input_tokens=100, output_tokens=50, cost_microdollars=1000),
            CostEventInput(provider="openai", model="gpt-4o-mini", input_tokens=200, output_tokens=80, cost_microdollars=500),
        ])

        assert result["inserted"] == 2
        body = json.loads(respx.calls[0].request.content)
        assert len(body["events"]) == 2


class TestActions:
    @respx.mock
    def test_create_action(self, ns):
        respx.post(f"{BASE}/api/actions").mock(
            return_value=httpx.Response(
                201,
                json={"id": "act_1", "status": "pending", "expiresAt": "2026-03-27T01:00:00Z"},
            )
        )

        result = ns.create_action(CreateActionInput(
            agent_id="agent-1",
            action_type="send_email",
            payload={"to": "user@example.com", "subject": "Hello"},
        ))

        assert result.id == "act_1"
        assert result.status == "pending"

    @respx.mock
    def test_get_action(self, ns):
        respx.get(f"{BASE}/api/actions/act_1").mock(
            return_value=httpx.Response(200, json={
                "data": {
                    "id": "act_1",
                    "agentId": "agent-1",
                    "actionType": "send_email",
                    "status": "approved",
                    "payload": {},
                    "metadata": None,
                    "createdAt": "2026-03-27T00:00:00Z",
                    "approvedAt": "2026-03-27T00:01:00Z",
                    "rejectedAt": None,
                    "executedAt": None,
                    "expiresAt": None,
                    "expiredAt": None,
                    "approvedBy": "user-1",
                    "rejectedBy": None,
                    "result": None,
                    "errorMessage": None,
                    "environment": None,
                    "sourceFramework": None,
                }
            })
        )

        action = ns.get_action("act_1")
        assert action.status == "approved"
        assert action.approved_by == "user-1"

    @respx.mock
    def test_mark_result(self, ns):
        respx.post(f"{BASE}/api/actions/act_1/result").mock(
            return_value=httpx.Response(200, json={"id": "act_1", "status": "executed"})
        )

        result = ns.mark_result("act_1", MarkResultInput(
            status="executed",
            result={"ok": True},
        ))

        assert result["status"] == "executed"


class TestBudgets:
    @respx.mock
    def test_check_budget(self, ns):
        respx.get(f"{BASE}/api/budgets/status").mock(
            return_value=httpx.Response(200, json={
                "entities": [{
                    "entityType": "api_key",
                    "entityId": "key_1",
                    "limitMicrodollars": 5000000,
                    "spendMicrodollars": 2100000,
                    "remainingMicrodollars": 2900000,
                    "policy": "strict_block",
                    "resetInterval": "monthly",
                    "currentPeriodStart": "2026-03-01T00:00:00Z",
                }]
            })
        )

        status = ns.check_budget()
        assert len(status.entities) == 1
        assert status.entities[0].remaining_microdollars == 2900000

    @respx.mock
    def test_list_budgets(self, ns):
        respx.get(f"{BASE}/api/budgets").mock(
            return_value=httpx.Response(200, json={
                "data": [{
                    "id": "budget_1",
                    "entityType": "api_key",
                    "entityId": "key_1",
                    "maxBudgetMicrodollars": 5000000,
                    "spendMicrodollars": 0,
                    "policy": "strict_block",
                    "resetInterval": "monthly",
                    "currentPeriodStart": "2026-03-01T00:00:00Z",
                    "thresholdPercentages": [50, 80, 95],
                    "velocityLimitMicrodollars": None,
                    "velocityWindowSeconds": None,
                    "velocityCooldownSeconds": None,
                    "sessionLimitMicrodollars": None,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-03-01T00:00:00Z",
                }]
            })
        )

        result = ns.list_budgets()
        assert len(result.data) == 1
        assert result.data[0].threshold_percentages == [50, 80, 95]


class TestCostEvents:
    @respx.mock
    def test_list_cost_events(self, ns):
        respx.get(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(200, json={
                "data": [{
                    "id": "evt_1",
                    "requestId": "req-001",
                    "apiKeyId": "ns_key_abc",
                    "provider": "openai",
                    "model": "gpt-4o",
                    "inputTokens": 100,
                    "outputTokens": 50,
                    "cachedInputTokens": 20,
                    "reasoningTokens": 0,
                    "costMicrodollars": 1500,
                    "durationMs": 320,
                    "sessionId": "session-abc",
                    "traceId": None,
                    "source": "proxy",
                    "tags": {"env": "prod"},
                    "keyName": "prod-key",
                    "createdAt": "2026-03-27T00:00:00Z",
                }],
                "cursor": None,
            })
        )

        result = ns.list_cost_events()
        assert len(result.data) == 1
        evt = result.data[0]
        assert evt.session_id == "session-abc"
        assert evt.tags == {"env": "prod"}
        assert evt.request_id == "req-001"
        assert evt.api_key_id == "ns_key_abc"
        assert evt.cached_input_tokens == 20
        assert evt.reasoning_tokens == 0
        assert evt.source == "proxy"
        assert evt.key_name == "prod-key"

    @respx.mock
    def test_list_cost_events_with_pagination(self, ns):
        respx.get(f"{BASE}/api/cost-events?limit=5").mock(
            return_value=httpx.Response(200, json={
                "data": [],
                "cursor": {"createdAt": "2026-03-27T00:00:00Z", "id": "evt_1"},
            })
        )

        result = ns.list_cost_events(ListCostEventsOptions(limit=5))
        assert result.cursor is not None
        assert result.cursor["id"] == "evt_1"


class TestRetries:
    @respx.mock
    def test_retries_on_500(self, ns):
        route = respx.get(f"{BASE}/api/budgets/status")
        route.side_effect = [
            httpx.Response(500, text="Internal Server Error"),
            httpx.Response(500, text="Internal Server Error"),
            httpx.Response(200, json={"entities": []}),
        ]

        status = ns.check_budget()
        assert len(status.entities) == 0
        assert route.call_count == 3

    @respx.mock
    def test_raises_after_max_retries(self, ns):
        respx.get(f"{BASE}/api/budgets/status").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )

        with pytest.raises(NullSpendError, match="Internal Server Error"):
            ns.check_budget()

    @respx.mock
    def test_no_retry_on_400(self, ns):
        route = respx.post(f"{BASE}/api/cost-events")
        route.mock(return_value=httpx.Response(
            400,
            json={"error": {"code": "validation_error", "message": "Invalid input"}},
        ))

        with pytest.raises(NullSpendError, match="Invalid input"):
            ns.report_cost(CostEventInput(
                provider="openai", model="gpt-4o",
                input_tokens=0, output_tokens=0, cost_microdollars=0,
            ))

        assert route.call_count == 1

    @respx.mock
    def test_idempotency_key_sent_on_post(self, ns):
        respx.post(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(201, json={"id": "evt_1", "createdAt": "2026-03-27T00:00:00Z"})
        )

        ns.report_cost(CostEventInput(
            provider="openai", model="gpt-4o",
            input_tokens=100, output_tokens=50, cost_microdollars=1000,
        ))

        req = respx.calls[0].request
        assert "idempotency-key" in req.headers
        assert req.headers["idempotency-key"].startswith("ns_")

    @respx.mock
    def test_no_idempotency_key_on_get(self, ns):
        respx.get(f"{BASE}/api/budgets/status").mock(
            return_value=httpx.Response(200, json={"entities": []})
        )

        ns.check_budget()

        req = respx.calls[0].request
        assert "idempotency-key" not in req.headers


class TestTimeoutNaming:
    def test_poll_timeout_does_not_shadow_builtin(self):
        """PollTimeoutError is distinct from Python's builtin TimeoutError."""
        import builtins
        assert PollTimeoutError is not builtins.TimeoutError
        # The alias still works for backward compat
        assert TimeoutError is PollTimeoutError

    def test_poll_timeout_is_nullspend_error(self):
        err = PollTimeoutError("act_1", 5000)
        assert isinstance(err, NullSpendError)
        assert err.action_id == "act_1"
        assert err.timeout_ms == 5000


class TestCachedTokens:
    @respx.mock
    def test_zero_cached_tokens_not_sent(self, ns):
        """cached_input_tokens=0 (default) should not appear in the body."""
        respx.post(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(201, json={"id": "evt_1", "createdAt": "2026-03-27T00:00:00Z"})
        )

        ns.report_cost(CostEventInput(
            provider="openai", model="gpt-4o",
            input_tokens=100, output_tokens=50, cost_microdollars=1000,
        ))

        body = json.loads(respx.calls[0].request.content)
        assert "cachedInputTokens" not in body
        assert "reasoningTokens" not in body

    @respx.mock
    def test_nonzero_cached_tokens_sent(self, ns):
        """cached_input_tokens=50 should be included in the body."""
        respx.post(f"{BASE}/api/cost-events").mock(
            return_value=httpx.Response(201, json={"id": "evt_1", "createdAt": "2026-03-27T00:00:00Z"})
        )

        ns.report_cost(CostEventInput(
            provider="openai", model="gpt-4o",
            input_tokens=100, output_tokens=50, cost_microdollars=1000,
            cached_input_tokens=50,
            reasoning_tokens=10,
        ))

        body = json.loads(respx.calls[0].request.content)
        assert body["cachedInputTokens"] == 50
        assert body["reasoningTokens"] == 10


class TestContextManager:
    @respx.mock
    def test_context_manager_closes_client(self):
        respx.get(f"{BASE}/api/budgets/status").mock(
            return_value=httpx.Response(200, json={"entities": []})
        )

        with NullSpend(base_url=BASE, api_key="ns_test_key") as ns:
            status = ns.check_budget()
            assert len(status.entities) == 0
        # Client should be closed after exiting context — no assertion needed,
        # just verify no exception is thrown


class TestErrorParsing:
    @respx.mock
    def test_parses_error_response(self, ns):
        respx.post(f"{BASE}/api/actions").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"code": "authentication_required", "message": "Missing API key", "details": None}},
            )
        )

        with pytest.raises(NullSpendError) as exc_info:
            ns.create_action(CreateActionInput(
                agent_id="agent-1", action_type="send_email", payload={},
            ))

        assert exc_info.value.status_code == 401
        assert exc_info.value.code == "authentication_required"
        assert "Missing API key" in str(exc_info.value)
