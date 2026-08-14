package chain

type Builder struct {
	parts []string
}

func (b *Builder) Add(part string) {
	b.parts = append(b.parts, part)
}

func (b *Builder) AddTwice(part string) {
	b.Add(part)
	b.Add(part)
}
