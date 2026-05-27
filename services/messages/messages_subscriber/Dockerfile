# Build stage
FROM golang:1.25-alpine AS builder

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
    CGO_ENABLED=0 GOOS=linux go build -o subscriber-bin .

# Run stage
FROM alpine:3.23

# Install curl for healthchecks (consistency with other services)
RUN apk add --no-cache curl

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/subscriber-bin .
RUN chmod +x subscriber-bin

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./subscriber-bin"]
