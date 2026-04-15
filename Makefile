default: build

generate:
	go generate ./internal/static/

build: generate
	go build -trimpath -o diffmil .

dev: build
	./diffmil $(ARGS)

clean:
	rm -f diffmil
	rm -rf internal/static/dist

.PHONY: default generate build dev clean
