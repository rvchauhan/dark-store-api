/**
 * Safely read a single route param from Express (params can be string | string[]).
 */
export function routeParam(value: string | string[] | undefined, name: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) throw new Error(`Missing route parameter: ${name}`);
  return v;
}
