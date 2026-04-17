FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o main .

FROM alpine:latest

# Install curl for healthchecks
RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /app/main .

EXPOSE 8005

CMD ["./main"]
