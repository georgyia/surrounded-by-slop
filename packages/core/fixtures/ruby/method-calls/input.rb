class Pipeline
  def first
  end

  def second
    first
  end

  def third
    second
    first
  end
end
