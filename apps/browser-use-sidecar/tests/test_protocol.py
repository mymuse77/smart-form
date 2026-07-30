import pytest
from pydantic import ValidationError

from smart_form_sidecar.protocol import ExecuteRequest, parse_request


def valid_execute() -> str:
    return (
        '{"protocol_version":"1.0.0","type":"execute","request_id":"request-1","task_id":"task-1",'
        '"cdp_endpoint":"http://127.0.0.1:49321","target_id":"target-1",'
        '"prompt":"Collect the order list","allowed_domains":["forms.example.com"],'
        '"max_steps":25}'
    )


def test_parses_loopback_execution_request() -> None:
    request = parse_request(valid_execute())

    assert isinstance(request, ExecuteRequest)
    assert request.allowed_domains == ["forms.example.com"]
    assert request.max_steps == 25


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://192.168.1.20:9222",
        "https://127.0.0.1:9222",
        "http://127.0.0.1",
    ],
)
def test_rejects_non_loopback_or_ambiguous_cdp_endpoint(endpoint: str) -> None:
    payload = valid_execute().replace("http://127.0.0.1:49321", endpoint)

    with pytest.raises(ValidationError):
        parse_request(payload)


def test_rejects_unknown_protocol_fields() -> None:
    payload = valid_execute()[:-1] + ',"launch_browser":true}'

    with pytest.raises(ValidationError):
        parse_request(payload)
