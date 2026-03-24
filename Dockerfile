FROM node:lts-alpine AS app

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN echo '{}' > public/config.json
RUN npm run build


FROM golang:1-alpine AS server

WORKDIR /src

COPY go.* ./
RUN go mod download

COPY *.go ./
COPY pkg ./pkg
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server

FROM alpine

WORKDIR /app

COPY --from=app /src/dist ./dist
COPY --from=server /src/server .

EXPOSE 8080

CMD ["./server"]