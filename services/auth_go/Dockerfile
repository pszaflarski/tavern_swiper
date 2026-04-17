# Build stage
FROM --platform=linux/amd64 golang:1.25-bookworm AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o auth-bin .

# Run stage
FROM --platform=linux/amd64 debian:bookworm-slim

WORKDIR /root/

# Install CA certificates for Firestore/Firebase connection
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the binary from the builder stage
COPY --from=builder /app/auth-bin .
RUN chmod +x auth-bin

# Expose port
EXPOSE 8001

# Run the binary
CMD ["./auth-bin"]
