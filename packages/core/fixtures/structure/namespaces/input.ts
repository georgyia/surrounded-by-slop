export namespace Geometry {
  export const PI = 3.14159;

  export function area(radius: number): number {
    return PI * radius * radius;
  }

  export namespace Units {
    export class Meter {
      value = 0;
    }
  }
}
