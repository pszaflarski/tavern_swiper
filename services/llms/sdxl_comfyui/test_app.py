"""Unit tests for SDXL ComfyUI FastAPI service."""

import os
import pytest
from fastapi.testclient import TestClient

from services.llms.sdxl_comfyui.app import app


def test_health_endpoint():
    client = TestClient(app)
    # Health endpoint without ComfyUI running should return degraded or unhealthy gracefully
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["comfyui"] is False


def test_auth_protection():
    os.environ["IMAGE_API_KEY"] = "test-secret-sdxl"
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401
    assert "Invalid or missing API key" in r_no_auth.json()["detail"]

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get(
        "/v1/models", headers={"Authorization": "Bearer wrong-key"}
    )
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get(
        "/v1/models", headers={"Authorization": "Bearer test-secret-sdxl"}
    )
    assert r_valid.status_code == 200
    model_ids = [m["id"] for m in r_valid.json()["data"]]
    assert "sdxl-lightning" in model_ids
    assert "sdxl-ipadapter-face" in model_ids

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]


def test_generate_image_validation():
    os.environ["IMAGE_API_KEY"] = "test-secret-sdxl"
    client = TestClient(app)

    # Invalid image size
    r = client.post(
        "/v1/images/generations",
        headers={"Authorization": "Bearer test-secret-sdxl"},
        json={"prompt": "test prompt", "size": "not-a-size"},
    )
    assert r.status_code == 400
    assert "Invalid size format" in r.json()["detail"]

    del os.environ["IMAGE_API_KEY"]
