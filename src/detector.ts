export class RateLimitDetector {
  private readonly patterns: RegExp[];

  constructor(patterns: string[]) {
    this.patterns = patterns.map((p) => new RegExp(p, "i"));
  }

  match(line: string): string | null {
    for (const re of this.patterns) {
      if (re.test(line)) return re.source;
    }
    return null;
  }

  test(line: string): boolean {
    return this.match(line) !== null;
  }
}
