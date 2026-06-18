# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download || true

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o worker-bin ./cmd

# Run stage
FROM alpine:3.23

# Install curl for healthchecks and tzdata for timezone database safety
RUN apk add --no-cache curl tzdata

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/worker-bin .
RUN chmod +x worker-bin

# Expose port
EXPOSE 8014

# Run the binary
CMD ["./worker-bin"]
