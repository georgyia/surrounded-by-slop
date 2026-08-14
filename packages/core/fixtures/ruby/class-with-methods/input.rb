class Greeter
  def greet(name)
    "hello #{name}"
  end

  def shout(name)
    greet(name).upcase
  end
end
