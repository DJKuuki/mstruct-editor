function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export class RationalRangeError extends RangeError {}

export function rational(numerator, denominator = 1) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new RationalRangeError("Invalid rational value");
  }
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  return { numerator: (sign * numerator) / divisor, denominator: Math.abs(denominator) / divisor };
}

export function addRational(left, right) {
  let numerator = BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator);
  let denominator = BigInt(left.denominator) * BigInt(right.denominator);
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator < 0n ? -denominator : denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a || 1n;
  denominator /= a || 1n;
  return rational(Number(numerator), Number(denominator));
}

export function equalRational(left, right) {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

export function rationalLabel(value) {
  return `${value.numerator}/${value.denominator}`;
}

export function parseFraction(value) {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2] ?? 1);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) return null;
  return rational(numerator, denominator);
}
