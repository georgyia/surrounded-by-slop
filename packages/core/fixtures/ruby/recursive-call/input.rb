def factorial(n)
  return 1 if n <= 1
  factorial(n - 1) * n
end
