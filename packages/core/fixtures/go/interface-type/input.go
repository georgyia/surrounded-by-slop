package api

type Handler interface {
	Handle(path string) error
}

type Logger interface {
	Log(message string)
}
