package store

type Store struct {
	rows map[string]string
}

func Open() *Store {
	return &Store{rows: map[string]string{}}
}

func (s *Store) Get(key string) string {
	return s.rows[key]
}
