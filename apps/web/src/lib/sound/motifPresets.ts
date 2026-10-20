/**
 * sound/motifPresets.ts — starting points for the motif's timbre (the Leva folder "모티프 음색 (세부)"): pick one,
 * then turn the knobs from there. Each sets every timbre knob (and the echo / far-space sends), so a preset is a
 * whole character, not a partial change.
 */

import type { SoundParams } from "./engine";

type Timbre = Pick<
  SoundParams,
  | "motifWave"
  | "motifAttackMs"
  | "motifDecayMs"
  | "motifSustain"
  | "motifRelease"
  | "motifCutoff"
  | "motifQ"
  | "motifFilterEnv"
  | "motifOctaveLevel"
  | "motifFifthLevel"
  | "motifDetune"
  | "motifVibrato"
  | "motifVibratoHz"
  | "motifBreath"
  | "motifTremolo"
  | "motifVerb"
  | "motifEcho"
  | "motifSynth"
  | "fmRatio"
  | "fmIndex"
  | "fmDecayMs"
>;

const SUB = { motifSynth: "subtractive" as const, fmRatio: 2, fmIndex: 2, fmDecayMs: 300 };

export const MOTIF_PRESETS: Record<string, Timbre> = {
  // the artist's direction: Interstellar, a signal sent out into space
  "전파 신호": { motifWave: "sine", motifAttackMs: 60, motifDecayMs: 200, motifSustain: 0.8, motifRelease: 1.2, motifCutoff: 6000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0.1, motifFifthLevel: 0, motifDetune: 4, motifVibrato: 0, motifVibratoHz: 5.5, motifBreath: 0.15, motifTremolo: 0.15, motifVerb: 0.5, motifEcho: 0.6, ...SUB },
  // the organ swell: slow, held, a little of the upper partials, the far space wide open
  "인터스텔라 오르간": { motifWave: "sine", motifAttackMs: 180, motifDecayMs: 400, motifSustain: 1, motifRelease: 1.5, motifCutoff: 5000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0.3, motifFifthLevel: 0.15, motifDetune: 3, motifVibrato: 0, motifVibratoHz: 5, motifBreath: 0.05, motifTremolo: 0.05, motifVerb: 0.85, motifEcho: 0.25, ...SUB },
  // a struck glass: instant, bright partials, a long ring
  "유리 종": { motifWave: "sine", motifAttackMs: 4, motifDecayMs: 600, motifSustain: 0.15, motifRelease: 1.6, motifCutoff: 9000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0.5, motifFifthLevel: 0.3, motifDetune: 2, motifVibrato: 0, motifVibratoHz: 5, motifBreath: 0, motifTremolo: 0, motifVerb: 0.6, motifEcho: 0.45, ...SUB },
  // breath through a pipe: a soft rise, the filter opening, air in the tone, a slow vibrato
  "숨 플루트": { motifWave: "triangle", motifAttackMs: 80, motifDecayMs: 150, motifSustain: 0.7, motifRelease: 0.6, motifCutoff: 3500, motifQ: 1.5, motifFilterEnv: 0.5, motifOctaveLevel: 0.15, motifFifthLevel: 0, motifDetune: 0, motifVibrato: 8, motifVibratoHz: 5.5, motifBreath: 0.5, motifTremolo: 0.1, motifVerb: 0.4, motifEcho: 0.3, ...SUB },
  // morse: short dry dots, their echoes doing the talking
  "모스 점": { motifWave: "sine", motifAttackMs: 3, motifDecayMs: 40, motifSustain: 0.9, motifRelease: 0.1, motifCutoff: 4000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0, motifFifthLevel: 0, motifDetune: 0, motifVibrato: 0, motifVibratoHz: 5, motifBreath: 0.1, motifTremolo: 0, motifVerb: 0.3, motifEcho: 0.7, ...SUB },
  // FM: a sine bent by a modulator — a transmission with an edge, then a bell
  "FM 전파": { motifWave: "sine", motifAttackMs: 40, motifDecayMs: 250, motifSustain: 0.8, motifRelease: 1.2, motifCutoff: 7000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0, motifFifthLevel: 0, motifDetune: 0, motifVibrato: 0, motifVibratoHz: 5.5, motifBreath: 0.1, motifTremolo: 0.12, motifVerb: 0.55, motifEcho: 0.55, motifSynth: "fm", fmRatio: 1.41, fmIndex: 1.5, fmDecayMs: 400 },
  "FM 벨": { motifWave: "sine", motifAttackMs: 3, motifDecayMs: 500, motifSustain: 0.2, motifRelease: 1.6, motifCutoff: 9000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0, motifFifthLevel: 0, motifDetune: 0, motifVibrato: 0, motifVibratoHz: 5, motifBreath: 0, motifTremolo: 0, motifVerb: 0.6, motifEcho: 0.4, motifSynth: "fm", fmRatio: 3.5, fmIndex: 4, fmDecayMs: 600 },
  // the light version's triangle, as it was before the timbre knobs
  "처음 그대로 (삼각)": { motifWave: "triangle", motifAttackMs: 12, motifDecayMs: 90, motifSustain: 0.55, motifRelease: 0.4, motifCutoff: 4000, motifQ: 0.7, motifFilterEnv: 0, motifOctaveLevel: 0.35, motifFifthLevel: 0, motifDetune: 0, motifVibrato: 0, motifVibratoHz: 5, motifBreath: 0, motifTremolo: 0, motifVerb: 0, motifEcho: 0.35, ...SUB },
};

export const MOTIF_PRESET_NAMES = Object.keys(MOTIF_PRESETS);
export const DEFAULT_MOTIF_PRESET = "전파 신호";
