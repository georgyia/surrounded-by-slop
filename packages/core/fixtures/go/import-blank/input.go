package main

import (
	_ "database/sql/driver"
	"database/sql"
)

func open() (*sql.DB, error) {
	return sql.Open("driver", "dsn")
}
