import os
import re

SERVICES = [
    "auth/auth_go",
    "auth/users_go",
    "discovery/discovery_go",
    "discovery/discovery_subscriber",
    "messages/messages_go",
    "messages/messages_subscriber",
    "profiles/profiles_go",
    "router/router_go"
]

def update_dockerignore():
    path = "services/auth/auth_go/.dockerignore"
    with open(path, "r") as f:
        content = f.read()
    
    content = content.replace(".env\n__pycache__", ".env\n.env.*\n__pycache__")
    content = content.replace("*.pyc\n*.pyo\n*.pyd\n.pytest_cache\ntests\nDockerfile", "*.pyc\n.pytest_cache\nDockerfile")
    content = content.replace("cloudbuild.yaml\n", "cloudbuild.yaml\nREADME.md\n\n# Test files (not needed in production image)\n*_test.go\nmock_*.go\nsnapshots.json\n")
    
    with open(path, "w") as f:
        f.write(content)

def update_dockerfiles():
    for svc in SERVICES:
        path = f"services/{svc}/Dockerfile"
        with open(path, "r") as f:
            content = f.read()
            
        # 1. Update auth_go specific things
        if svc == "auth/auth_go":
            content = content.replace("golang:1.25-bookworm", "golang:1.25-alpine")
            content = content.replace("debian:bookworm-slim", "alpine:3.23")
            content = content.replace("apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*", "apk add --no-cache curl ca-certificates")
        
        # 2. Pin alpine
        content = content.replace("alpine:latest", "alpine:3.23")
        
        # 3. Add BuildKit cache for go mod download
        if "RUN go mod download" in content:
            content = content.replace("RUN go mod download", "RUN --mount=type=cache,target=/go/pkg/mod \\\n    go mod download")
            
        # 4. Add BuildKit cache and standardize CGO_ENABLED for go build
        if svc == "auth/auth_go":
            content = content.replace("RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o auth-bin .", "RUN --mount=type=cache,target=/go/pkg/mod \\\n    --mount=type=cache,target=/root/.cache/go-build \\\n    CGO_ENABLED=0 GOOS=linux go build -o auth-bin .")
        elif svc in ["discovery_subscriber", "messages_subscriber"]:
            content = content.replace("RUN CGO_ENABLED=0 GOOS=linux go build -o subscriber-bin .", "RUN --mount=type=cache,target=/go/pkg/mod \\\n    --mount=type=cache,target=/root/.cache/go-build \\\n    CGO_ENABLED=0 GOOS=linux go build -o subscriber-bin .")
        else:
            content = content.replace("RUN go build -o main .", "RUN --mount=type=cache,target=/go/pkg/mod \\\n    --mount=type=cache,target=/root/.cache/go-build \\\n    CGO_ENABLED=0 GOOS=linux go build -o main .")
            
        with open(path, "w") as f:
            f.write(content)

def update_cloudbuild():
    for svc in SERVICES:
        path = f"services/{svc}/cloudbuild.yaml"
        with open(path, "r") as f:
            content = f.read()
            
        # 1. Add volumes to step 1
        content = re.sub(
            r"(dir: 'services/[^/]+/\$_DIR_NAME')\n",
            r"\1\n    volumes:\n      - name: 'go-modules'\n        path: '/go/pkg/mod'\n",
            content,
            count=1
        )
        
        # 2. Build step (Step 2)
        content = re.sub(
            r"(args: \['build', '-t', 'gcr\.io/\$PROJECT_ID/\$_SERVICE_NAME(?:latest|:latest)?', '\.'\]\n\s*dir: 'services/[^/]+/\$_DIR_NAME')\n",
            r"args: ['build', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA', '-t', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME:latest', '.']\n    dir: 'services/{}/$_DIR_NAME'\n    env:\n      - 'DOCKER_BUILDKIT=1'\n".format(svc.split('/')[0]),
            content,
            count=1
        )
        # Note: the group substitution was a bit loose, replacing via string replace might be safer.
        # Let's use string replace for build args
        
        # 3. Push step
        content = re.sub(
            r"args: \['push', 'gcr\.io/\$PROJECT_ID/\$_SERVICE_NAME(?:latest|:latest)?'\]",
            r"args: ['push', '--all-tags', 'gcr.io/$PROJECT_ID/$_SERVICE_NAME']",
            content
        )
        
        # 4. Deploy step
        content = re.sub(
            r"--image=gcr\.io/\$PROJECT_ID/\$_SERVICE_NAME:latest",
            r"--image=gcr.io/$PROJECT_ID/$_SERVICE_NAME:$SHORT_SHA",
            content
        )
        
        with open(path, "w") as f:
            f.write(content)

update_dockerignore()
update_dockerfiles()
update_cloudbuild()
print("Done")
