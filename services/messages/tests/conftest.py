import pytest
from unittest.mock import MagicMock, patch
from freezegun import freeze_time
import respx

@pytest.fixture(autouse=True)
def frozen_time():
    with freeze_time("2026-04-17 12:00:00Z"):
        yield

@pytest.fixture(autouse=True)
def mock_db():
    with patch("main.db") as mock:
        yield mock
        mock.reset_mock(return_value=True, side_effect=True)
        # Deep reset
        for attr in ['collection', 'batch']:
            getattr(mock, attr).reset_mock()

@pytest.fixture(autouse=True)
def mock_auth_service():
    """Activates respx to mock cross-service calls globally."""
    with respx.mock(assert_all_called=False) as respx_mock:
        yield respx_mock
