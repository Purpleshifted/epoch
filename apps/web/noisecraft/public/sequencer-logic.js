/**
 * Sequencer Logic Module
 * Handles individual and global audio routing with sequencer patterns
 */

export class SequencerLogic {
  constructor() {
    // Individual sequencers: one column per voice (bass, baritone, tenor)
    this.individualSequencers = {
      bass: null, // MonoSeq node ID
      baritone: null, // MonoSeq node ID
      tenor: null, // MonoSeq node ID
    };

    // Global sequencers: multiple columns for chord progression
    this.globalSequencers = {
      bass: null, // MonoSeq node ID
      baritone: null, // MonoSeq node ID
      tenor: null, // MonoSeq node ID
    };
  }

  /**
   * Set sequencer node IDs
   * @param {Object} sequencers - { individual: {bass, baritone, tenor}, global: {bass, baritone, tenor} }
   */
  setSequencerNodes(sequencers) {
    if (sequencers.individual) {
      this.individualSequencers = sequencers.individual;
    }
    if (sequencers.global) {
      this.globalSequencers = sequencers.global;
    }
  }

  /**
   * Generate individual sequencer pattern for a particle
   * Individual: each voice has 1 column, so max chord is 3 notes
   * Returns pattern in format: { bass: [12 notes], baritone: [12 notes], tenor: [12 notes] }
   * Each array has exactly one 1 and the rest are 0
   *
   * @param {Object} selfParticle - The controlled particle
   * @param {Array} innerParticles - Array of particle objects in inner radius (with getActiveNoteIndex method)
   * @returns {Object} Pattern updates for individual sequencers
   */
  /**
   * Map 12-tone chromatic note index (0-11) to 4-row sequencer (0-3)
   * Uses a simple mapping: divide by 3 and round
   * 0-2 -> 0, 3-5 -> 1, 6-8 -> 2, 9-11 -> 3
   */
  map12ToneTo4Row(noteIndex12) {
    if (noteIndex12 < 0 || noteIndex12 >= 12) return 0;
    return Math.floor(noteIndex12 / 3);
  }

  /**
   * Generate arpeggiator pattern: spread available notes across 12 steps
   * This creates a random arpeggiator pattern using the available notes as "ingredients"
   *
   * @param {Array} availableNotes - Array of 12-tone note indices (0-11) that are available
   * @param {Number} numSteps - Number of steps in sequencer (default 12)
   * @returns {Array} Pattern array: [step0[row0, row1, ..., row11], step1[...], ...]
   *   Each step has exactly one note active (one row = 1, rest = 0)
   */
  generateArpeggiatorPattern(availableNotes, numSteps = 12) {
    if (!Array.isArray(availableNotes) || availableNotes.length === 0) {
      // Return empty pattern (all zeros)
      return Array(numSteps)
        .fill(null)
        .map(() => new Array(12).fill(0));
    }

    // Create pattern: array of steps, each step is array of 12 rows
    const pattern = Array(numSteps)
      .fill(null)
      .map(() => new Array(12).fill(0));

    // Randomly distribute available notes across steps
    // Each step gets one note, chosen randomly from available notes
    for (let step = 0; step < numSteps; step++) {
      // Pick a random note from available notes
      const randomNoteIndex =
        availableNotes[Math.floor(Math.random() * availableNotes.length)];
      if (randomNoteIndex >= 0 && randomNoteIndex < 12) {
        // Set this note active at this step
        pattern[step][randomNoteIndex] = 1;
      }
    }

    return pattern;
  }

  generateIndividualPattern(selfParticle, innerParticles) {
    // Collect available notes as "ingredients" for arpeggiator
    const availableNotes = [];

    // Self particle's note (always available)
    if (selfParticle && typeof selfParticle.getActiveNoteIndex === "function") {
      const selfNoteIndex12 = selfParticle.getActiveNoteIndex();
      if (selfNoteIndex12 >= 0 && selfNoteIndex12 < 12) {
        availableNotes.push(selfNoteIndex12);
      }
    }

    // Inner particles' notes (added when in inner radius)
    // Each inner particle contributes its pattern information as "ingredients"
    if (Array.isArray(innerParticles) && innerParticles.length > 0) {
      innerParticles.forEach((innerParticle, index) => {
        if (
          !innerParticle ||
          typeof innerParticle.getActiveNoteIndex !== "function"
        )
          return;
        if (index >= 2) return; // Only use first 2 inner particles (max 3 notes total)

        // Get note from inner particle (as if receiving pattern info from that particle)
        const noteIndex12 = innerParticle.getActiveNoteIndex();
        if (noteIndex12 >= 0 && noteIndex12 < 12) {
          availableNotes.push(noteIndex12);
        }

        // TODO: In future, also receive noise pattern from inner particle
        // For now, just pass (noise implementation later)
      });
    }

    // Generate arpeggiator patterns for each voice (bass, baritone, tenor)
    // Each voice uses ALL available notes, creating independent arpeggiator patterns
    const numSteps = 12; // Use 12 steps for arpeggiator pattern

    // Bass voice: uses all available notes
    const bassPattern = this.generateArpeggiatorPattern(
      availableNotes,
      numSteps
    );

    // Baritone voice: uses all available notes (same ingredients, different pattern)
    const baritonePattern = this.generateArpeggiatorPattern(
      availableNotes,
      numSteps
    );

    // Tenor voice: uses all available notes (same ingredients, different pattern)
    const tenorPattern = this.generateArpeggiatorPattern(
      availableNotes,
      numSteps
    );

    // Return in format compatible with updateMonoSeqSequencer
    // Convert from NoiseCraft format [step][row] to row-based format for each voice
    // Actually, we'll return the full pattern directly since updateMonoSeqSequencer can handle it
    return {
      bass: bassPattern,
      baritone: baritonePattern,
      tenor: tenorPattern,
      // Keep columns for backwards compatibility (not used in arpeggiator mode)
      columns: {
        bass: null,
        baritone: null,
        tenor: null,
      },
    };
  }

  /**
   * Generate global sequencer pattern for all particles
   * Global: 12 columns per voice (bass, baritone, tenor), total 36 positions
   * Each particle is assigned to ONE of 36 positions (bass 0-11, baritone 0-11, tenor 0-11)
   * Pattern format: 12-step sequencer patterns [step0[row0...row11], step1[...], ...]
   *
   * Uses Harmonic Progression Algorithm for musically meaningful placement
   *
   * @param {Array} allParticles - All particles in the system
   * @param {Object} assignments - Optional: pre-assigned positions { particleId: { voice: 'bass'|'baritone'|'tenor', column: 0-11 } }
   * @param {Object} harmonicPlacer - Optional: GlobalHarmonicPlacer instance (creates new one if not provided)
   * @returns {Object} Pattern updates: { bass: [12 steps x 12 rows], baritone: [...], tenor: [...] }
   */
  generateGlobalPattern(
    allParticles,
    assignments = {},
    harmonicPlacer = null,
    verbose = false
  ) {
    // Initialize patterns: 12 steps, each with 12 rows (one per semitone)
    const bassPattern = Array(12)
      .fill(null)
      .map(() => new Array(12).fill(0));
    const baritonePattern = Array(12)
      .fill(null)
      .map(() => new Array(12).fill(0));
    const tenorPattern = Array(12)
      .fill(null)
      .map(() => new Array(12).fill(0));

    // Use harmonic placer if provided, otherwise fall back to random
    // (Caller should import and create GlobalHarmonicPlacer if harmonic placement is desired)

    // Track used positions to avoid duplicates
    const usedPositions = {
      bass: new Set(),
      baritone: new Set(),
      tenor: new Set(),
    };

    // Sort particles by ID for consistent ordering
    const sortedParticles = [...allParticles].sort((a, b) => a.id - b.id);
    const totalUsers = sortedParticles.length;

    // If harmonic placer is available, use it for new assignments
    let useHarmonicPlacement =
      harmonicPlacer !== null &&
      typeof harmonicPlacer.assignNewUser === "function";

    // Update harmonic placer with existing assignments (don't clear, just sync)
    if (useHarmonicPlacement) {
      harmonicPlacer.updateAssignmentsFromMap(
        assignments,
        sortedParticles,
        false
      );
    }

    // Count particles with valid notes for logging
    const validParticles = sortedParticles.filter((p) => {
      const noteIndex = p.getActiveNoteIndex();
      return noteIndex >= 0 && noteIndex < 12;
    });

    if (validParticles.length === 0) {
      console.warn("[SequencerLogic] No particles with valid notes");
      return {
        bass: bassPattern,
        baritone: baritonePattern,
        tenor: tenorPattern,
        assignments: assignments,
      };
    }

    // Log current state only if verbose
    if (verbose) {
      const existingAssignments = Object.keys(assignments).length;
      const availablePos = useHarmonicPlacement
        ? harmonicPlacer.getAvailablePositions().length
        : 36;
      console.log(
        `[SequencerLogic] Generating pattern: ${validParticles.length} valid particles, ${existingAssignments} existing assignments, ${availablePos} available positions`
      );
    }

    sortedParticles.forEach((particle) => {
      // Use tone property as fallback if pattern is empty
      let noteIndex = particle.getActiveNoteIndex();
      if (noteIndex < 0 || noteIndex >= 12) {
        // Fallback to tone property
        if (particle.tone !== undefined) {
          noteIndex = particle.tone % 12;
        }
        if (noteIndex < 0 || noteIndex >= 12) {
          if (
            !window._lastNoteIndexWarning ||
            Date.now() - window._lastNoteIndexWarning > 5000
          ) {
            console.warn(
              `[SequencerLogic] Particle ${particle.id} has invalid note index: ${noteIndex} (tone: ${particle.tone})`
            );
            window._lastNoteIndexWarning = Date.now();
          }
          return;
        }
      }

      // Get assignment for this particle (voice and column position)
      let assignment = assignments[particle.id];

      // If no assignment, use harmonic placement or random fallback
      if (!assignment) {
        if (useHarmonicPlacement) {
          // Use harmonic progression algorithm
          try {
            const position = harmonicPlacer.assignNewUser(
              noteIndex,
              totalUsers,
              verbose
            );
            if (position >= 0 && position < 36) {
              const voiceIndex = Math.floor(position / 12);
              const column = position % 12;
              const voices = ["bass", "baritone", "tenor"];
              const voice = voices[voiceIndex];

              // Check if position is already used
              if (!usedPositions[voice].has(column)) {
                assignment = { voice, column };
                usedPositions[voice].add(column);
                harmonicPlacer.addAssignment(noteIndex, position);
                assignments[particle.id] = assignment; // Update assignments map

                // Log new assignment only if verbose
                if (verbose) {
                  console.log(
                    `[SequencerLogic] ✓ Assigned particle ${particle.id} (note: ${noteIndex}) to ${voice} column ${column} (position: ${position})`
                  );
                }
              } else {
                // Fallback to random if harmonic placement conflicts
                console.warn(
                  `[SequencerLogic] Harmonic placement conflict for particle ${particle.id}, using random`
                );
                assignment = this._getRandomAvailablePosition(usedPositions);
                if (assignment) {
                  assignments[particle.id] = assignment;
                }
              }
            } else {
              // Fallback to random if harmonic placement fails
              console.warn(
                `[SequencerLogic] Harmonic placement returned invalid position ${position} for particle ${particle.id}, using random`
              );
              assignment = this._getRandomAvailablePosition(usedPositions);
              if (assignment) {
                assignments[particle.id] = assignment;
              }
            }
          } catch (e) {
            console.warn(
              "[SequencerLogic] Harmonic placement failed, using random:",
              e
            );
            assignment = this._getRandomAvailablePosition(usedPositions);
            if (assignment) {
              assignments[particle.id] = assignment;
            }
          }
        } else {
          // Random fallback
          assignment = this._getRandomAvailablePosition(usedPositions);
          if (assignment) {
            assignments[particle.id] = assignment;
          }
        }

        if (!assignment) {
          console.warn(
            `[Global] All 36 positions are filled, skipping particle ${particle.id}`
          );
          return;
        }
      } else {
        // Track existing assignment
        usedPositions[assignment.voice].add(assignment.column);
      }

      // Place note at assigned column (step) and row (noteIndex)
      const targetPattern =
        assignment.voice === "bass"
          ? bassPattern
          : assignment.voice === "baritone"
          ? baritonePattern
          : tenorPattern;

      if (
        assignment.column >= 0 &&
        assignment.column < 12 &&
        noteIndex >= 0 &&
        noteIndex < 12
      ) {
        targetPattern[assignment.column][noteIndex] = 1;

        // Log pattern placement only if verbose
        if (verbose) {
          console.log(
            `[SequencerLogic] ✓ Placed note ${noteIndex} at ${assignment.voice} step ${assignment.column} for particle ${particle.id}`
          );
        }
      } else {
        console.warn(
          `[SequencerLogic] Invalid assignment for particle ${particle.id}:`,
          assignment,
          `noteIndex: ${noteIndex}`
        );
      }
    });

    // Log final pattern state only if verbose
    if (verbose) {
      const bassCount = bassPattern.reduce(
        (sum, step) => sum + step.reduce((s, c) => s + (c === 1 ? 1 : 0), 0),
        0
      );
      const baritoneCount = baritonePattern.reduce(
        (sum, step) => sum + step.reduce((s, c) => s + (c === 1 ? 1 : 0), 0),
        0
      );
      const tenorCount = tenorPattern.reduce(
        (sum, step) => sum + step.reduce((s, c) => s + (c === 1 ? 1 : 0), 0),
        0
      );
      console.log(
        `[SequencerLogic] Pattern summary: Bass=${bassCount}, Baritone=${baritoneCount}, Tenor=${tenorCount}, Total=${
          bassCount + baritoneCount + tenorCount
        }`
      );
    }

    return {
      bass: bassPattern,
      baritone: baritonePattern,
      tenor: tenorPattern,
      assignments: assignments, // Return assignments for tracking
    };
  }

  /**
   * Helper: Get random available position (fallback method)
   * @private
   */
  _getRandomAvailablePosition(usedPositions) {
    const voices = ["bass", "baritone", "tenor"];
    const availableVoices = voices.filter(
      (voice) => usedPositions[voice].size < 12
    );

    if (availableVoices.length === 0) {
      return null; // All positions filled
    }

    const randomVoice =
      availableVoices[Math.floor(Math.random() * availableVoices.length)];
    const availableColumns = Array.from({ length: 12 }, (_, i) => i).filter(
      (col) => !usedPositions[randomVoice].has(col)
    );

    if (availableColumns.length === 0) {
      return null;
    }

    const randomColumn =
      availableColumns[Math.floor(Math.random() * availableColumns.length)];
    return { voice: randomVoice, column: randomColumn };
  }

  /**
   * Calculate spatialization parameters for outer particles
   * @param {Object} selfParticle - The controlled particle
   * @param {Object} outerParticle - Particle in outer radius
   * @returns {Object} { pan: -1 to 1, gain: 0 to 1, distance: number }
   */
  calculateSpatialization(selfParticle, outerParticle) {
    const dx = outerParticle.position.x - selfParticle.position.x;
    const dy = outerParticle.position.y - selfParticle.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Pan: -1 (left) to 1 (right) based on horizontal position
    const pan = Math.max(-1, Math.min(1, dx / 400)); // Normalize to ±400px range

    // Gain: distance-based attenuation
    // Fade out at outer radius, max at inner radius
    const outerRadius = 150; // Should match SignalGenerator outerRadius
    const gain = Math.max(0, 1 - distance / outerRadius);

    return {
      pan,
      gain,
      distance,
      angle: Math.atan2(dy, dx), // Angle for spatial audio
    };
  }

  /**
   * Generate updates for NoiseCraft sequencer nodes
   * @param {Object} signals - Signal data from generateSignals()
   * @param {Number} particleId - The controlled particle ID
   * @returns {Array} Array of update messages for NoiseCraft
   */
  generateNoiseCraftUpdates(signals, particleId) {
    const updates = [];

    // Individual audio: update sequencer patterns
    if (signals.innerParticles && signals.innerParticles.length > 0) {
      // This would need access to selfParticle to generate pattern
      // Pattern generation should be done at higher level with full particle data
    }

    // Outer particles: spatialization would be handled via pan/gain nodes
    // These would need to be mapped in the parameter mapping UI

    return updates;
  }
}

/**
 * Helper function to convert note pattern array to NoiseCraft MonoSeq format
 * NoiseCraft MonoSeq uses pattern format: patterns[patternIndex][stepIndex][rowIndex]
 *
 * @param {Array} notePattern - Array like [1,0,0,0] indicating active note (4 elements for 4-row sequencer)
 * @param {Number} numSteps - Number of steps in sequencer (default 4 for individual)
 * @param {Number} stepPosition - Which step to place the note on (default 0, or cycle through steps)
 * @returns {Array} NoiseCraft pattern format: [step0[row0, row1, ...], step1[...], ...]
 */
export function convertNotePatternToNoiseCraft(
  notePattern,
  numSteps = 4,
  stepPosition = 0
) {
  // Support both 12-element (old) and 4-element (new) patterns
  const expectedLength = notePattern.length;
  if (
    !Array.isArray(notePattern) ||
    (expectedLength !== 4 && expectedLength !== 12)
  ) {
    console.warn(
      "Invalid note pattern, expected 4 or 12 elements:",
      notePattern
    );
    return Array(numSteps)
      .fill(null)
      .map(() => new Array(4).fill(0));
  }

  // Create empty pattern: array of steps, each step is array of 4 rows (or 12 for backward compat)
  const numRows = expectedLength === 12 ? 12 : 4;
  const pattern = Array(numSteps)
    .fill(null)
    .map(() => new Array(numRows).fill(0));

  // Find active note
  const activeNoteIndex = notePattern.findIndex((val) => val === 1);
  if (
    activeNoteIndex >= 0 &&
    activeNoteIndex < numRows &&
    stepPosition < numSteps
  ) {
    // Place note at stepPosition, row activeNoteIndex
    pattern[stepPosition][activeNoteIndex] = 1;
  }

  return pattern;
}

// Track column positions for each voice (persistent random assignment per particle)
const voiceColumnPositions = new Map(); // nodeId -> column position (0-3)

// Track last-sent grid state to avoid flooding iframe with full clears
// key: `${nodeId}:${patternIndex}:${numSteps}:${numRows}` -> Uint8Array (flattened [step][row])
const lastSentGrids = new Map();

function makeGridKey(nodeId, patternIndex, numSteps, numRows) {
  return `${String(nodeId)}:${patternIndex}:${numSteps}:${numRows}`;
}

function buildFlattenedGridFromArp(notePattern, numSteps, numRows) {
  const grid = new Uint8Array(numSteps * numRows);
  const patternSteps = Array.isArray(notePattern) ? notePattern.length : 0;
  for (let step = 0; step < Math.min(patternSteps, numSteps); step++) {
    const stepPattern = notePattern[step];
    if (!Array.isArray(stepPattern)) continue;
    for (let row = 0; row < Math.min(stepPattern.length, numRows); row++) {
      grid[step * numRows + row] = stepPattern[row] === 1 ? 1 : 0;
    }
  }
  return grid;
}

function buildFlattenedGridSingle(activeStep, activeRow, numSteps, numRows) {
  const grid = new Uint8Array(numSteps * numRows);
  if (
    typeof activeStep === "number" &&
    typeof activeRow === "number" &&
    activeStep >= 0 &&
    activeStep < numSteps &&
    activeRow >= 0 &&
    activeRow < numRows
  ) {
    grid[activeStep * numRows + activeRow] = 1;
  }
  return grid;
}

/**
 * Update a MonoSeq sequencer node in NoiseCraft with a new pattern
 * Supports both single-note patterns and arpeggiator patterns (full 12x12 grid)
 * @param {Object} iframeWindow - The NoiseCraft iframe window
 * @param {String} nodeId - The MonoSeq node ID
 * @param {Number} patternIndex - Which pattern to update (usually 0)
 * @param {Array} notePattern - Can be:
 *   - Array like [1,0,0,...,0] for single note (4 or 12 elements) - OLD FORMAT
 *   - Array of arrays: [[step0[row0, row1, ...], step1[...], ...] - ARPEGGIATOR FORMAT (12 steps x 12 rows)
 * @param {Number} numSteps - Number of steps in sequencer (default 12 for arpeggiator, was 4)
 * @param {Number} columnPosition - Optional: deprecated for arpeggiator mode
 */
export function updateMonoSeqSequencer(
  iframeWindow,
  nodeId,
  patternIndex,
  notePattern,
  numSteps = 12,
  columnPosition = null
) {
  if (!iframeWindow || !nodeId || !Array.isArray(notePattern)) {
    console.warn("Invalid parameters for updateMonoSeqSequencer:", {
      iframeWindow,
      nodeId,
      notePattern,
    });
    return;
  }

  // Check if this is arpeggiator format (array of arrays) or old single-note format
  // Arpeggiator format: [[step0[row0, row1, ...]], [step1[...]], ...]
  // Old format: [1, 0, 0, ..., 0] (single row array)
  const isArpeggiatorFormat =
    notePattern.length > 0 &&
    Array.isArray(notePattern[0]) &&
    typeof notePattern[0][0] === "number";

  if (isArpeggiatorFormat) {
    // ARPEGGIATOR MODE: Full pattern [step][row]
    const patternSteps = notePattern.length;
    const patternRows = notePattern[0]?.length || 12;

    // Count active cells first
    let cellCount = 0;
    for (let step = 0; step < Math.min(patternSteps, numSteps); step++) {
      const stepPattern = notePattern[step];
      if (!Array.isArray(stepPattern)) continue;
      for (
        let row = 0;
        row < Math.min(stepPattern.length, patternRows);
        row++
      ) {
        if (stepPattern[row] === 1) cellCount++;
      }
    }

    const key = makeGridKey(nodeId, patternIndex, numSteps, patternRows);
    const nextGrid = buildFlattenedGridFromArp(
      notePattern,
      numSteps,
      patternRows
    );
    const prevGrid = lastSentGrids.get(key);

    requestAnimationFrame(() => {
      let changeCount = 0;

      // If we don't have a previous snapshot, do one full sync once.
      if (!prevGrid || prevGrid.length !== nextGrid.length) {
        for (let step = 0; step < numSteps; step++) {
          for (let row = 0; row < patternRows; row++) {
            const v = nextGrid[step * patternRows + row];
            iframeWindow.postMessage(
              {
                type: "noiseCraft:toggleCell",
                nodeId: String(nodeId),
                patIdx: patternIndex,
                stepIdx: step,
                rowIdx: row,
                value: v,
              },
              "*"
            );
            changeCount++;
          }
        }
      } else {
        // Diff sync: only send changed cells
        for (let idx = 0; idx < nextGrid.length; idx++) {
          const v = nextGrid[idx];
          if (prevGrid[idx] === v) continue;
          const step = Math.floor(idx / patternRows);
          const row = idx % patternRows;
          iframeWindow.postMessage(
            {
              type: "noiseCraft:toggleCell",
              nodeId: String(nodeId),
              patIdx: patternIndex,
              stepIdx: step,
              rowIdx: row,
              value: v,
            },
            "*"
          );
          changeCount++;
        }
      }

      lastSentGrids.set(key, nextGrid);

      const shouldLog =
        !window._lastSequencerLog ||
        Date.now() - window._lastSequencerLog > 2000;
      if (shouldLog) {
        console.log(
          `[Sequencer] Updated node ${nodeId} (arp): ${patternSteps} steps, ${cellCount} active, ${changeCount} cells sent`
        );
        window._lastSequencerLog = Date.now();
      }
    });
    return;
  }

  // OLD FORMAT: Single note pattern [1,0,0,...,0] (backwards compatibility)
  // Validate note pattern (now supports both 4 and 12 elements)
  if (notePattern.length !== 4 && notePattern.length !== 12) {
    console.warn(
      "Note pattern must have 4 or 12 elements (or be arpeggiator format), got:",
      notePattern.length
    );
    return;
  }

  const numRows = notePattern.length; // 4 or 12

  // Find active note index (should be exactly one)
  const activeNoteIndex = notePattern.findIndex((val) => val === 1);

  // Get or assign column position (step 0-3) for this voice
  // Column position is persistent per voice/node - assigned randomly once and reused
  let stepPosition;
  if (
    columnPosition !== null &&
    columnPosition >= 0 &&
    columnPosition < numSteps
  ) {
    // Use provided column position
    stepPosition = columnPosition;
    voiceColumnPositions.set(nodeId, stepPosition);
  } else {
    // Get stored column position or assign random one
    stepPosition = voiceColumnPositions.get(nodeId);
    if (stepPosition === undefined) {
      // Assign random column position (0-3) - this is the "random placement" requirement
      stepPosition = Math.floor(Math.random() * numSteps);
      voiceColumnPositions.set(nodeId, stepPosition);
    }
  }

  const key = makeGridKey(nodeId, patternIndex, numSteps, numRows);
  const nextGrid =
    activeNoteIndex < 0
      ? buildFlattenedGridSingle(null, null, numSteps, numRows) // all zeros
      : buildFlattenedGridSingle(
          stepPosition,
          activeNoteIndex,
          numSteps,
          numRows
        );
  const prevGrid = lastSentGrids.get(key);

  requestAnimationFrame(() => {
    let changeCount = 0;

    if (!prevGrid || prevGrid.length !== nextGrid.length) {
      for (let step = 0; step < numSteps; step++) {
        for (let row = 0; row < numRows; row++) {
          const v = nextGrid[step * numRows + row];
          iframeWindow.postMessage(
            {
              type: "noiseCraft:toggleCell",
              nodeId: String(nodeId),
              patIdx: patternIndex,
              stepIdx: step,
              rowIdx: row,
              value: v,
            },
            "*"
          );
          changeCount++;
        }
      }
    } else {
      for (let idx = 0; idx < nextGrid.length; idx++) {
        const v = nextGrid[idx];
        if (prevGrid[idx] === v) continue;
        const step = Math.floor(idx / numRows);
        const row = idx % numRows;
        iframeWindow.postMessage(
          {
            type: "noiseCraft:toggleCell",
            nodeId: String(nodeId),
            patIdx: patternIndex,
            stepIdx: step,
            rowIdx: row,
            value: v,
          },
          "*"
        );
        changeCount++;
      }
    }

    lastSentGrids.set(key, nextGrid);

    if (activeNoteIndex < 0) {
      const shouldLog =
        !window._lastSequencerClearLog ||
        Date.now() - window._lastSequencerClearLog > 2000;
      if (shouldLog) {
        console.log(
          `[Sequencer] Cleared node ${nodeId} (empty pattern), ${changeCount} cells sent`
        );
        window._lastSequencerClearLog = Date.now();
      }
      return;
    }

    const shouldLog =
      !window._lastSequencerLog || Date.now() - window._lastSequencerLog > 2000;
    if (shouldLog) {
      console.log(
        `[Sequencer] Updated node ${nodeId}, pattern ${patternIndex}, column ${stepPosition} (random persistent), row ${activeNoteIndex}, ${changeCount} cells sent`
      );
      window._lastSequencerLog = Date.now();
    }
  });
}

/**
 * Multi-user scenario logic suggestion:
 *
 * 1. **User Registration**: When a new user joins, create a particle for them
 *    - Assign random note profile [1,0,...,0] to [0,0,...,1]
 *    - Add to particle system
 *
 * 2. **Individual Audio (per user)**:
 *    - Each user hears: their own note + notes of particles in inner radius
 *    - Pattern: bass[self note], baritone[first inner note], tenor[second inner note]
 *    - Maximum 3 notes (chord)
 *    - Spatial panning for outer particles (if any)
 *
 * 3. **Global Audio (for audience)**:
 *    - All particles contribute to global sequencers
 *    - Pattern: bass 1st column -> baritone 1st column -> tenor 1st column ->
 *               bass 2nd column -> baritone 2nd column -> ...
 *    - Creates chord progression as users join/leave
 *    - Multiple columns allow audience to hear full chord progression
 *
 * 4. **Particle Management**:
 *    - When user disconnects: remove their particle
 *    - When user moves: update particle position/velocity
 *    - Note profile stays constant per user (or can be updated)
 *
 * 5. **Implementation**:
 *    - Use WebSocket/Socket.IO for real-time updates
 *    - Each client maintains its own particle system with all users
 *    - Individual audio: local calculation from particle system
 *    - Global audio: aggregated and sent to all clients
 *
 * 6. **Sequencer Updates**:
 *    - Individual: Update when inner particles change
 *    - Global: Update when any particle joins/leaves
 *    - Use NoiseCraft's ToggleCell action to update patterns
 */
