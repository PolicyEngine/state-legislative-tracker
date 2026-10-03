"""Tests for the Claude scoring call in auto_triage.py.

No network and no API key: the real Anthropic SDK builds each request and a
mock transport answers it. Run with:

    uv run --with "anthropic>=1.9" --with pytest --with hypothesis \
        pytest scripts/test_auto_triage.py
"""

import json
import sys
import types
from pathlib import Path

import httpx2
import pytest
from anthropic import Anthropic, DefaultHttpxClient
from hypothesis import example, given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).parent))
# score_bill never touches Supabase; stub it so the tests don't need it installed.
sys.modules.setdefault("supabase", types.SimpleNamespace(create_client=None))

import auto_triage  # noqa: E402

BILL = {
    "state": "GA",
    "bill_number": "HB 111",
    "title": "Reduce the income tax rate",
    "description": "Lowers the flat rate from 5.39% to 4.99%.",
}
THINKING = {"type": "thinking", "thinking": "", "signature": "sig"}


def message(content, stop_reason="end_turn", stop_details=None):
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "stop_details": stop_details,
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


def client_returning(body, requests=None):
    def handler(request):
        if requests is not None:
            requests.append(json.loads(request.content))
        return httpx2.Response(200, json=body)

    return Anthropic(
        api_key="test-key",
        max_retries=0,
        http_client=DefaultHttpxClient(transport=httpx2.MockTransport(handler)),
    )


def text_reply(text, leading_thinking=False):
    blocks = [THINKING] if leading_thinking else []
    return message(blocks + [{"type": "text", "text": text}])


def test_request_is_valid_for_sonnet_5_5():
    requests = []
    reply = text_reply('{"score": 90, "reform_type": "parametric", "reasoning": "Rate cut."}')
    auto_triage.score_bill(client_returning(reply, requests), BILL)

    (body,) = requests
    assert body["model"] == "claude-sonnet-5-5"
    assert body["output_config"] == {"effort": "low"}
    assert body["max_tokens"] >= 4096
    assert body["system"] == auto_triage.SCORING_PROMPT
    # Parameters Sonnet 5.5 rejects, or that would change scoring behavior.
    for rejected in ("temperature", "top_p", "top_k", "thinking", "tool_choice"):
        assert rejected not in body
    # No assistant prefill: the conversation ends on the user's turn.
    assert [m["role"] for m in body["messages"]] == ["user"]


def test_reads_text_block_after_thinking_block():
    reply = text_reply(
        '{"score": 60, "reform_type": "structural", "reasoning": "New credit."}',
        leading_thinking=True,
    )
    result = auto_triage.score_bill(client_returning(reply), BILL)
    assert result == {"score": 60, "reform_type": "structural", "reasoning": "New credit."}


def test_refusal_raises_instead_of_scoring():
    reply = message(
        [],
        stop_reason="refusal",
        stop_details={"type": "refusal", "category": "general_harms", "explanation": None},
    )
    with pytest.raises(RuntimeError, match="declined.*general_harms"):
        auto_triage.score_bill(client_returning(reply), BILL)


def test_refusal_without_category_still_raises():
    reply = message([], stop_reason="refusal", stop_details=None)
    with pytest.raises(RuntimeError, match="declined.*unspecified"):
        auto_triage.score_bill(client_returning(reply), BILL)


def test_truncated_response_raises():
    reply = message([THINKING, {"type": "text", "text": '{"score": 4'}], stop_reason="max_tokens")
    with pytest.raises(RuntimeError, match="max_tokens"):
        auto_triage.score_bill(client_returning(reply), BILL)


# Invariant: score_bill returns exactly the object the model wrote in its text
# block, whatever thinking block precedes it and whether or not it wrapped the
# JSON in a markdown fence. Triple backticks are excluded from the reasoning
# because the fence stripping splits on them; the explicit example covers
# single backticks, quotes, braces, backslashes and newlines.
scores = st.fixed_dictionaries(
    {
        "score": st.integers(min_value=0, max_value=100),
        "reform_type": st.sampled_from(["parametric", "structural", "unknown"]),
        "reasoning": st.text(max_size=200).filter(lambda s: "```" not in s),
    }
)


@settings(max_examples=50, deadline=None)
@given(
    expected=scores,
    fence=st.sampled_from(["", "```\n", "```json\n"]),
    leading_thinking=st.booleans(),
    padding=st.sampled_from(["", " ", "\n"]),
)
@example(
    expected={
        "score": 85,
        "reform_type": "parametric",
        "reasoning": 'Sets `rate` to "4.99%" in {gov.states.ga.tax} \\ ``x``\nonly.',
    },
    fence="```json\n",
    leading_thinking=True,
    padding="\n",
)
def test_parsed_score_round_trips(expected, fence, leading_thinking, padding):
    payload = json.dumps(expected)
    text = f"{padding}{fence}{payload}\n```{padding}" if fence else f"{padding}{payload}{padding}"
    reply = text_reply(text, leading_thinking=leading_thinking)
    assert auto_triage.score_bill(client_returning(reply), BILL) == expected
