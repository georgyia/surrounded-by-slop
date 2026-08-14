package com.shop.api;

import com.shop.store.OrderRepository;

public class OrderController {
    private final OrderRepository repository;

    public OrderController(OrderRepository repository) {
        this.repository = repository;
    }

    public String find(String id) {
        return repository.byId(id);
    }
}
