function base(): number {
  return 1;
}

function twice(): number {
  return base() + base();
}

export function entry(): number {
  return twice();
}
