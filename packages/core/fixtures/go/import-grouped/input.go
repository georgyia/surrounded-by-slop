package main

import (
	"errors"
	"os"
)

func fail() error {
	os.Exit(1)
	return errors.New("unreachable")
}
