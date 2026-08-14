package types

type ID int

type Pair struct {
	Left  int
	Right int
}

type Callback func(id ID) error
