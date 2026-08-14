require "json"
require "net/http"

class Client
  def parse(body)
    JSON.parse(body)
  end
end
