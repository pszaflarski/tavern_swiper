# Build stage
FROM --platform=linux/amd64 golang:1.25-alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy the source code
COPY . .

# Build the application
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -o auth-bin .

# Run stage
FROM --platform=linux/amd64 alpine:3.23

WORKDIR /root/

# Install CA certificates and curl for Firestore/Firebase connection and healthchecks
RUN apk add --no-cache curl ca-certificates

# Copy the binary from the builder stage
COPY --from=builder /app/auth-bin .
RUN chmod +x auth-bin

# Expose port
EXPOSE 8001

# Run the binary
CMD ["./auth-bin"]
