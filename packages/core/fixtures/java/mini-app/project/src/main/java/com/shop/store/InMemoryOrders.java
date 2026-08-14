package com.shop.store;

import java.util.HashMap;

public class InMemoryOrders implements OrderRepository {
    private final HashMap<String, String> rows = new HashMap<>();

    public String byId(String id) {
        return rows.get(id);
    }
}
