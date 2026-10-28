const NATURAL_PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS = {
  "": { offset: 0, vexflow: null },
  b: { offset: -1, vexflow: "b" },
  bb: { offset: -2, vexflow: "bb" },
  "#": { offset: 1, vexflow: "#" },
  x: { offset: 2, vexflow: "##" },
};

const STAFF_RENDER_HEIGHT = 260;
const STAFF_RENDER_MIN_WIDTH = 240;
const STAFF_LINE_MAX_WIDTH = 240;
const STAFF_VIEWPORT_TOP_PADDING = 7;
const STAFF_VIEWPORT_BOTTOM_PADDING = 9;
const TREBLE_STAVE_Y = 18;
const BASS_STAVE_Y = 92;
const TREBLE_CUTOFF_MIDI = 60;

export function staffForMidi(midi) {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new TypeError(`Invalid MIDI note: ${midi}`);
  return midi >= TREBLE_CUTOFF_MIDI ? "treble" : "bass";
}

export function staffViewportFromBounds(bounds) {
  const y = Number(bounds?.y);
  const height = Number(bounds?.height);
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Invalid staff content bounds.");
  }

  const top = Math.floor(y - STAFF_VIEWPORT_TOP_PADDING);
  const bottom = Math.ceil(y + height + STAFF_VIEWPORT_BOTTOM_PADDING);
  return { y: top, height: Math.max(1, bottom - top) };
}

function normalizeNoteName(noteName) {
  return String(noteName)
    .replaceAll("𝄫", "bb")
    .replaceAll("♭", "b")
    .replaceAll("𝄪", "x")
    .replaceAll("♯", "#");
}

export function toVexflowNote(noteName, midi) {
  const normalized = normalizeNoteName(noteName);
  const match = /^([A-G])(bb|b|#|x)?$/.exec(normalized);
  if (!match || !Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new TypeError(`Invalid staff note: ${noteName}/${midi}`);
  }

  const letter = match[1];
  const accidental = match[2] ?? "";
  const accidentalData = ACCIDENTALS[accidental];
  const octaveBase = midi - NATURAL_PITCH_CLASSES[letter] - accidentalData.offset;
  if (octaveBase % 12 !== 0) throw new TypeError(`Note name and MIDI pitch disagree: ${noteName}/${midi}`);

  const octave = octaveBase / 12 - 1;
  const keyAccidental = accidentalData.vexflow ?? "";
  return {
    accidental: accidentalData.vexflow,
    key: `${letter.toLowerCase()}${keyAccidental}/${octave}`,
    midi,
    staffPosition: `${letter.toLowerCase()}/${octave}`,
  };
}

export function chordNotesForStaff(noteNames, midiNotes) {
  if (noteNames.length !== midiNotes.length) throw new TypeError("Chord note names and MIDI notes must have the same length.");
  const pitches = noteNames.map((noteName, index) => toVexflowNote(noteName, midiNotes[index]));
  const spellingsByPosition = new Map();

  for (const pitch of pitches) {
    const spellings = spellingsByPosition.get(pitch.staffPosition) ?? new Set();
    spellings.add(pitch.accidental ?? "n");
    spellingsByPosition.set(pitch.staffPosition, spellings);
  }

  return pitches.map((pitch) => ({
    ...pitch,
    accidental: spellingsByPosition.get(pitch.staffPosition).size > 1 && pitch.accidental === null ? "n" : pitch.accidental,
  }));
}

export function staffChordLayout(pitches) {
  const sortedPitches = [...pitches].sort((left, right) => left.midi - right.midi);
  const keyIndexesByPosition = new Map();
  const keys = [];
  const accidentals = [];

  for (const pitch of sortedPitches) {
    const keyIndexes = keyIndexesByPosition.get(pitch.staffPosition) ?? [];
    let keyIndex = keyIndexes.at(-1);

    if (keyIndexes.length < 2) {
      keyIndex = keys.length;
      keys.push(pitch.key);
      keyIndexes.push(keyIndex);
      keyIndexesByPosition.set(pitch.staffPosition, keyIndexes);
    }

    if (pitch.accidental) accidentals.push({ index: keyIndex, midi: pitch.midi, type: pitch.accidental });
  }

  return {
    accidentals: accidentals.sort((left, right) => right.midi - left.midi),
    keys,
  };
}

async function shareVexflowFonts(targetDocument) {
  const sourceDocument = globalThis.document;
  if (!sourceDocument?.fonts || !targetDocument?.fonts || sourceDocument === targetDocument) return;
  await Promise.allSettled([
    sourceDocument.fonts.load('40px "Bravura"'),
    sourceDocument.fonts.load('40px "Academico"'),
  ]);
  await sourceDocument.fonts.ready;
  const fontLoads = [];
  sourceDocument.fonts.forEach((fontFace) => {
    if (!/^(?:Bravura|Academico)$/.test(fontFace.family.replaceAll('"', ""))) return;
    try {
      targetDocument.fonts.add(fontFace);
      fontLoads.push(fontFace.loaded);
    } catch {
      // A browser may already expose the same FontFace in both documents.
    }
  });
  await Promise.allSettled(fontLoads);
  await targetDocument.fonts.ready;
}

export async function drawChordStaff(canvas, noteNames, midiNotes, options = {}) {
  if (globalThis.document?.fonts) {
    await Promise.allSettled([
      globalThis.document.fonts.load('40px "Bravura"'),
      globalThis.document.fonts.load('40px "Academico"'),
    ]);
    await globalThis.document.fonts.ready;
  }
  const vexflow = options.vexflow ?? await import("vexflow/core");
  vexflow.VexFlow.setFonts("Bravura", "Academico");
  await shareVexflowFonts(canvas.ownerDocument);
  if (options.isCancelled?.()) return null;

  const pitches = chordNotesForStaff(noteNames, midiNotes);
  const treblePitches = pitches.filter((pitch) => staffForMidi(pitch.midi) === "treble").sort((left, right) => left.midi - right.midi);
  const bassPitches = pitches.filter((pitch) => staffForMidi(pitch.midi) === "bass").sort((left, right) => left.midi - right.midi);
  const width = Math.max(STAFF_RENDER_MIN_WIDTH, Math.floor(canvas.clientWidth));
  const staveWidth = Math.min(STAFF_LINE_MAX_WIDTH, width - 32);
  const staveX = Math.floor((width - staveWidth) / 2);

  canvas.replaceChildren();
  const renderer = new vexflow.Renderer(canvas, vexflow.Renderer.Backends.SVG);
  renderer.resize(width, STAFF_RENDER_HEIGHT);
  const context = renderer.getContext();
  context.setFillStyle(options.color ?? "#26342d");
  context.setStrokeStyle(options.color ?? "#26342d");

  const trebleStave = new vexflow.Stave(staveX, TREBLE_STAVE_Y, staveWidth, { leftBar: false, rightBar: false }).addClef("treble");
  const bassStave = new vexflow.Stave(staveX, BASS_STAVE_Y, staveWidth, { leftBar: false, rightBar: false }).addClef("bass");
  vexflow.Stave.formatBegModifiers([trebleStave, bassStave]);
  const chordX = staveX + staveWidth * 0.38;
  trebleStave.setNoteStartX(chordX);
  bassStave.setNoteStartX(chordX);
  trebleStave.setContext(context).draw();
  bassStave.setContext(context).draw();
  new vexflow.StaveConnector(trebleStave, bassStave).setType("brace").setContext(context).draw();

  function createVoice(pitchGroup, clef, stave) {
    if (pitchGroup.length === 0) return null;
    const layout = staffChordLayout(pitchGroup);
    const chord = new vexflow.StaveNote({ clef, duration: "w", keys: layout.keys });
    for (const accidental of layout.accidentals) {
      chord.addModifier(new vexflow.Accidental(accidental.type), accidental.index);
    }
    const voice = new vexflow.Voice({ numBeats: 4, beatValue: 4 }).addTickable(chord).setStave(stave);
    return { chord, stave, voice };
  }

  const staffVoices = [createVoice(treblePitches, "treble", trebleStave), createVoice(bassPitches, "bass", bassStave)].filter(Boolean);
  if (staffVoices.length > 0) {
    const formatter = new vexflow.Formatter();
    for (const entry of staffVoices) formatter.joinVoices([entry.voice]);
    formatter.formatToStave(staffVoices.map((entry) => entry.voice), trebleStave);
    for (const entry of staffVoices) entry.voice.draw(context, entry.stave);
  }

  const noteBounds = staffVoices.map((entry) => entry.chord.getBoundingBox());
  const contentTop = Math.min(trebleStave.getTopLineTopY() - 13, ...noteBounds.map((bounds) => bounds.getY()));
  const contentBottom = Math.max(bassStave.getBottomLineBottomY() + 1, ...noteBounds.map((bounds) => bounds.getY() + bounds.getH()));
  const viewport = staffViewportFromBounds({ y: contentTop, height: contentBottom - contentTop });
  context.setViewBox(0, viewport.y, width, viewport.height);
  context.svg.setAttribute("height", String(viewport.height));
  context.svg.style.height = `${viewport.height}px`;
  canvas.style.height = `${viewport.height}px`;
  return { height: viewport.height, viewport, width };
}
