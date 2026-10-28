import score from "../style.css?inline";
import chord from "../../public/chord-popover.css?inline";
import roman from "../../public/roman-popover.css?inline";
import comment from "../../public/comment-popover.css?inline";
import duration from "../../public/duration-notes.css?inline";
import inline from "../../public/inline-music.css?inline";
import accidentals from "../../public/text-accidentals.css?inline";

// Installed inside the embed's shadow root, never in the host document.
export const scoreEmbedStyles = [accidentals, score, chord, roman, comment, duration, inline].join("\n");
