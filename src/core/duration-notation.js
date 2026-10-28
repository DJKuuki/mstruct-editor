const BASIC_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64];
const MAX_BASIC_DENOMINATOR = BASIC_DENOMINATORS.at(-1);

function asFraction(fraction) {
  return { kind: "fraction", fraction };
}

function asNotes(fraction, notes, multiplier = 1) {
  return { kind: "notes", fraction, notes, multiplier };
}

/** Describe the displayed duration without changing the parsed rhythmic value. */
export function describeDuration(value, fraction = `${value?.numerator}/${value?.denominator}`) {
  const numerator = value?.numerator;
  const denominator = value?.denominator;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) {
    return asFraction(fraction);
  }

  if (!Number.isInteger(Math.log2(denominator))) {
    const basicDenominator = 2 ** Math.floor(Math.log2(denominator));
    return basicDenominator <= MAX_BASIC_DENOMINATOR
      ? asNotes(fraction, [{ denominator: basicDenominator, dots: 0, tuplet: denominator }], numerator)
      : asFraction(fraction);
  }

  for (const basicDenominator of BASIC_DENOMINATORS) {
    for (let dots = 1; dots <= 3; dots += 1) {
      const dottedNumerator = BigInt(2 ** (dots + 1) - 1);
      const dottedDenominator = BigInt(basicDenominator * 2 ** dots);
      if (BigInt(numerator) * dottedDenominator === BigInt(denominator) * dottedNumerator) {
        return asNotes(fraction, [{ denominator: basicDenominator, dots, tuplet: null }]);
      }
    }
  }

  if (denominator > MAX_BASIC_DENOMINATOR) return asFraction(fraction);

  const wholeNotes = Math.floor(numerator / denominator);
  if (wholeNotes >= 5) return asNotes(fraction, [{ denominator, dots: 0, tuplet: null }], numerator);

  const notes = Array.from({ length: wholeNotes }, () => ({ denominator: 1, dots: 0, tuplet: null }));
  let remainder = numerator % denominator;
  for (let units = denominator / 2; units >= 1; units /= 2) {
    if (remainder >= units) {
      notes.push({ denominator: denominator / units, dots: 0, tuplet: null });
      remainder -= units;
    }
  }
  if (notes.length <= 4) return asNotes(fraction, notes);
  return asNotes(fraction, [{ denominator, dots: 0, tuplet: null }], numerator);
}

/** Reserve enough slot width for glyphs, dots, tuplet numerals and a multiplier. */
export function durationDisplayWidth(value, mode, fraction) {
  const fractionWidth = [...String(fraction)].length * 8 + 16;
  const displayed = describeDuration(value, fraction);
  if (displayed.kind === "fraction") return fractionWidth;
  const notesWidth = displayed.notes.reduce((width, note) => {
    const numeralWidth = note.tuplet ? String(note.tuplet).length * 9 : 0;
    return width + Math.max(18, numeralWidth) + note.dots * 8 + 4;
  }, 0);
  const noteWidth = notesWidth + (displayed.multiplier > 1 ? (`×${displayed.multiplier}`.length * 9) : 0) + 16;
  // Reserve the same width in both modes so changing the visible label never
  // reflows measures or changes event spacing.
  void mode;
  return Math.max(fractionWidth, noteWidth);
}
