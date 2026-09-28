import os
import pytest
from fastapi.testclient import TestClient

def test_auth_z_image():
    # Import app
    os.environ["IMAGE_API_KEY"] = "test-secret-key-123"
    from services.llms.z_image_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401
    assert "Invalid or missing API key" in r_no_auth.json()["detail"]

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-123"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_flux():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-456"
    from services.llms.flux_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-456"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_sdxl():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-789"
    from services.llms.sdxl_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-789"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 3

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_krea2():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-krea"
    from services.llms.krea2_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-krea"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_kolors():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-kolors"
    from services.llms.kolors_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-kolors"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_flux2_klein():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-flux2"
    from services.llms.flux2_klein_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-flux2"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_omnigen():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-omni"
    from services.llms.omnigen_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-omni"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


def test_auth_z_image_omni():
    os.environ["IMAGE_API_KEY"] = "test-secret-key-z-omni"
    from services.llms.z_image_omni_comfyui.app import app
    client = TestClient(app)

    # 1. Unauthenticated request to /v1/models should fail 401
    r_no_auth = client.get("/v1/models")
    assert r_no_auth.status_code == 401

    # 2. Invalid key should fail 401
    r_wrong_auth = client.get("/v1/models", headers={"Authorization": "Bearer wrong-key"})
    assert r_wrong_auth.status_code == 401

    # 3. Valid key should succeed 200
    r_valid = client.get("/v1/models", headers={"Authorization": "Bearer test-secret-key-z-omni"})
    assert r_valid.status_code == 200
    assert len(r_valid.json()["data"]) == 2

    # 4. Clean up
    del os.environ["IMAGE_API_KEY"]

    # 5. When IMAGE_API_KEY is not set, requests pass through without error
    r_open = client.get("/v1/models")
    assert r_open.status_code == 200


