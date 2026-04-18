# Build stage
FROM --platform=linux/amd64 golang:1.25-bookworm AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application
# We build cmd/local/main.go which uses the funcframework for local execution
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o subscriber-bin ./cmd/local/main.go

# Run stage
FROM --platform=linux/amd64 debian:bookworm-slim

WORKDIR /root/

# Install CA certificates for Firestore connection
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the binary from the builder stage
COPY --from=builder /app/subscriber-bin .
RUN chmod +x subscriber-bin

# Expose port
EXPOSE 8007

# Run the binary
CMD ["./subscriber-bin"]
