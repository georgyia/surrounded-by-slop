from .db import query

def handler():
    return query("select 1")
