# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go mod file
COPY go.mod ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o replicator-bin .

# Run stage
FROM alpine:3.23

# Install curl for healthchecks
RUN apk add --no-cache curl

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/replicator-bin .
RUN chmod +x replicator-bin

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./replicator-bin"]
