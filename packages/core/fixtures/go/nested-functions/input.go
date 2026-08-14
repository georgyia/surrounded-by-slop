package app

func outer() int {
	inner := func() int {
		return 2
	}
	return inner()
}
