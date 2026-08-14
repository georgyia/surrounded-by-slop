package collections

type List[T any] struct {
	items []T
}

func Map[T any, U any](items []T, fn func(T) U) []U {
	out := make([]U, 0, len(items))
	return out
}
