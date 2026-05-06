# Frontend Docker Build Optimization

Now that the Go microservices have been optimized with `.dockerignore` files, BuildKit cache mounts, and explicit image tagging, the next step is to apply similar optimizations to the React Native / Expo web frontend build.

## Current State

The `frontend/` directory has its own `Dockerfile` and `cloudbuild.yaml`. While it does have a `.dockerignore`, there are significant optimization opportunities:

1. **No BuildKit caching for NPM**: The `npm install` step downloads all dependencies from scratch on every build. For a JS project, this is usually the slowest part of the build.
2. **Missing SHA Tagging**: The frontend Cloud Build pushes `gcr.io/$PROJECT_ID/app$_ENV_SUFFIX` without an explicit `:latest` or `:$SHORT_SHA` tag, suffering from the same lack of immutability as the backend previously did.
3. **No BuildKit enabled in Cloud Build**: The `docker build` command in `frontend/cloudbuild.yaml` does not have `DOCKER_BUILDKIT=1` set.

## Implementation Plan

### 1. Add BuildKit Cache Mount to Dockerfile

Modify `frontend/Dockerfile` to cache the `~/.npm` directory during the install step.

**Before:**
```dockerfile
# Install dependencies
COPY package*.json ./
RUN npm install
```

**After:**
```dockerfile
# Install dependencies
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install
```

### 2. Enable BuildKit in `cloudbuild.yaml`

In `frontend/cloudbuild.yaml`, add the environment variable to enable BuildKit.

```yaml
  # 3. Build Frontend Image
  - name: 'gcr.io/cloud-builders/docker'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        source /workspace/build.env
        docker build -t "gcr.io/$PROJECT_ID/app$_ENV_SUFFIX:$SHORT_SHA" \
          -t "gcr.io/$PROJECT_ID/app$_ENV_SUFFIX:latest" \
          --platform linux/amd64 \
          # ... existing build args ...
          ./frontend
    env:
      - 'DOCKER_BUILDKIT=1'
```

### 3. Implement SHA Tagging for the Frontend

Update the push and deploy steps in `frontend/cloudbuild.yaml` to push all tags and deploy the specific commit SHA.

**Push step:**
```yaml
  # 2. Push Image (Note: Step numbering in current file is slightly off)
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '--all-tags', 'gcr.io/$PROJECT_ID/app$_ENV_SUFFIX']
```

**Deploy step:**
```yaml
  # 3. Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'app$_ENV_SUFFIX'
      - '--image'
      - 'gcr.io/$PROJECT_ID/app$_ENV_SUFFIX:$SHORT_SHA'
      # ...
```

By completing these steps, the frontend build will experience significantly faster install times and provide the same safe, rollback-friendly deployments as the backend services.
