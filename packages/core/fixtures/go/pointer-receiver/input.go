package counter

type Counter struct {
	total int
}

func (c *Counter) Add(n int) {
	c.total += n
}

func (c *Counter) Reset() {
	c.Add(-c.total)
}
