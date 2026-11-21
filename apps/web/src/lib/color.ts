/** Black or white, whichever reads better on the given hex background (WCAG luminance). */
export function textColorOn(hex: string): '#ffffff' | '#0f172a' {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(value.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. against near-black; pick the higher.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.06 ? '#ffffff' : '#0f172a';
}
