import colors from './item-colors.json';

/** Stable icon-derived accent; unknown materials retain the neutral theme colors. */
export function itemColor(name?: string): string | undefined {
  return name ? (colors as Record<string, string>)[name] : undefined;
}
