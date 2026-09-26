import io
import json
import os
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from unittest.mock import patch, MagicMock

os.environ["IMAGE_API_KEY"] = "test-secret-key-123"
from app import (
    app,
    generate_face_protection_mask,
    BASE_TURBO_WORKFLOW,
    BASE_EDIT_WORKFLOW,
    BASE_INPAINT_WORKFLOW,
    NODE_INPAINT_IMAGE,
    NODE_INPAINT_MASK,
    NODE_INPAINT_SAMPLER,
    NODE_INPAINT_PROMPT,
)

client = TestClient(app)


def test_generate_face_protection_mask():
    """Verify face protection mask generation returns valid feathered grayscale mask."""
    test_img = Image.new("RGB", (896, 1152), (180, 180, 180))
    draw = ImageDraw.Draw(test_img)
    draw.ellipse([300, 80, 580, 400], fill=(240, 200, 180))

    img_buf = io.BytesIO()
    test_img.save(img_buf, format="PNG")
    img_bytes = img_buf.getvalue()

    mask_bytes = generate_face_protection_mask(img_bytes, feather_radius=15)
    assert len(mask_bytes) > 0

    mask_img = Image.open(io.BytesIO(mask_bytes))
    assert mask_img.size == (896, 1152)
    assert mask_img.mode == "L"

    pixels = mask_img.load()
    assert pixels[448, 240] < 50
    assert pixels[100, 1000] > 200


def test_inpaint_workflow_integrity():
    """Verify ComfyUI inpaint workflow has all required nodes and valid connections."""
    wf = BASE_INPAINT_WORKFLOW
    assert NODE_INPAINT_IMAGE in wf
    assert NODE_INPAINT_MASK in wf
    assert NODE_INPAINT_SAMPLER in wf
    assert NODE_INPAINT_PROMPT in wf

    noise_mask_node = "18"
    assert noise_mask_node in wf
    assert wf[noise_mask_node]["class_type"] == "SetLatentNoiseMask"
    assert wf[NODE_INPAINT_SAMPLER]["inputs"]["latent_image"] == [noise_mask_node, 0]


def test_auth_verification():
    """Verify security rules on protected endpoints."""
    resp = client.get("/health")
    assert resp.status_code != 401

    resp = client.get("/v1/models")
    assert resp.status_code == 401

    resp = client.get(
        "/v1/models", headers={"Authorization": "Bearer test-secret-key-123"}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert any(m["id"] == "z-image-turbo" for m in data)


def test_health_with_mock():
    """Verify /health returns 200 when ComfyUI responds."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"devices": [{"name": "mock-gpu"}]}

    async def mock_get(*args, **kwargs):
        return mock_resp

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"


def test_edit_image_auth_required():
    """Verify edit endpoint requires auth."""
    resp = client.post("/v1/images/edits", data={"prompt": "test"})
    assert resp.status_code == 401
