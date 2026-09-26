/**
 * Path globs for ignore rules. `*` matches within one path segment,
 * `**` matches across segments. Paths look like `a.b[0].c`.
 */
export function compileGlobs(globs: string[] = []): RegExp[] {
  return globs.map((g) => {
    const src = g
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^.\\[\\]]*'),
      )
      .join('.*');
    return new RegExp(`^${src}$`);
  });
}

export function matchesAny(path: string, globs: RegExp[]): boolean {
  return globs.some((r) => r.test(path));
}
