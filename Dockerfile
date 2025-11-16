FROM node:lts-alpine AS app

WORKDIR /src

COPY package.json .
RUN npm install

COPY . .
RUN echo '{}' > public/config.json
RUN npm run build


FROM golang:1-alpine AS server

WORKDIR /src

COPY go.* .
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o server


FROM alpine

WORKDIR /app

COPY --from=app /src/dist ./dist
COPY --from=server /src/server .

EXPOSE 8080

CMD ["./server"]