# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o notifications-bin .

# Run stage
FROM alpine:3.23

# Install curl for healthchecks
RUN apk add --no-cache curl

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/notifications-bin .
RUN chmod +x notifications-bin

# Expose port
EXPOSE 8014

# Run the binary
CMD ["./notifications-bin"]
