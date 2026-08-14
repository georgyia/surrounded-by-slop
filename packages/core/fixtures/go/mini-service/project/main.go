package main

import (
	"fmt"

	"example.com/service/handler"
)

func main() {
	h := handler.New()
	fmt.Println(h.Serve("/health"))
}
