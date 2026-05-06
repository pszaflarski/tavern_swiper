FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:3.23

# Install curl for healthchecks
RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /app/main .

EXPOSE 8005

CMD ["./main"]
