require_relative "../lib/store"
require "json"

module Shop
  class Orders
    def initialize
      @store = Store.new
    end

    def find(id)
      lookup(id)
    end

    def lookup(id)
      @store.get(id)
    end
  end
end
