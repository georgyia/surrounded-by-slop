package handler

import "example.com/service/store"

type Handler struct {
	db *store.Store
}

func New() *Handler {
	return &Handler{db: store.Open()}
}

func (h *Handler) Serve(path string) string {
	return h.lookup(path)
}

func (h *Handler) lookup(path string) string {
	return h.db.Get(path)
}
