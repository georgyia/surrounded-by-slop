export class Shape {
  area = 0;
}

export class Circle extends Shape {
  radius = 1;
}

class Hidden extends Circle {
  note = "not exported";
}
