package store

type Server struct {
	name string
}

func (s Server) Name() string {
	return s.name
}

func (s Server) Describe() string {
	return s.Name()
}
