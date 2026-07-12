export function access(user: boolean, admin: boolean): string {
  if (user) {
    if (admin) {
      return "full";
    }
    return "limited";
  }
  return "none";
}
