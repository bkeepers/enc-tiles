// Polyfill of Object.groupBy
export function groupBy<T>(
  arr: T[],
  callback: (item: T, index: number, items: T[]) => string,
): Record<string, T[]> {
  return arr.reduce((acc, ...args) => {
    const key = callback(...args);
    acc[key] ??= [];
    acc[key].push(args[0]);
    return acc;
  }, {});
}
