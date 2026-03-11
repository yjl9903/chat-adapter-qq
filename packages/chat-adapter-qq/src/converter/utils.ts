export function isHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return /^https?:\/\//i.test(value);
}

export function parseSize(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return undefined;
  }

  return num;
}

export function basename(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const normalized = value.replace(/\\/g, '/');
  const lastPart = normalized.split('/').pop() ?? '';
  const [withoutQuery] = lastPart.split('?');

  return withoutQuery || fallback;
}
