/**
 * Global Harmonic Progression Placer
 * Implements harmonic progression algorithm for global audio sequencer placement
 * Based on HARMONIC_PROGRESSION_ALGORITHM.md
 */

// Instability map (from HARMONIC_PROGRESSION_ALGORITHM.md)
const INSTABILITY_MAP = {
  0: 0,    // C (Tonic/Unison) - 가장 안정
  1: 9,    // C#/Db (Minor 2nd) - 매우 높은 dissonance
  2: 3,    // D (Major 2nd) - 중간 dissonance
  3: 2,    // D#/Eb (Minor 3rd) - 낮은 dissonance, consonant
  4: 1.5,  // E (Major 3rd) - 낮은 dissonance, consonant
  5: 2.5,  // F (Perfect 4th) - 낮은 dissonance, consonant
  6: 8,    // F#/Gb (Tritone) - 매우 높은 dissonance
  7: 0.5,  // G (Perfect 5th) - 가장 낮은 dissonance, most consonant
  8: 4,    // G#/Ab (Minor 6th) - 중간 dissonance
  9: 2,    // A (Major 6th) - 낮은 dissonance, consonant
  10: 4.5, // A#/Bb (Minor 7th) - 중간-높은 dissonance
  11: 7,   // B (Major 7th/Leading tone) - 높은 dissonance
};

export class GlobalHarmonicPlacer {
  constructor(key = 'C', mode = 'major') {
    this.key = key;
    this.mode = mode;
    this.assignedPositions = []; // [{ note: 0-11, position: 0-35, voice: 0-2, step: 0-11 }]
  }

  /**
   * 유저 수에 따른 목표 harmonic distance
   */
  calculateTargetDistance(userCount) {
    // 유저 1명: distance 0 (tonic)
    // 유저 많을수록: 더 높은 distance (progression이 멀리)
    const maxDistance = 8;
    return Math.min(maxDistance, Math.log(userCount + 1) * 2);
  }

  /**
   * 현재 progression의 harmonic distance (간단 버전)
   * 실제로는 Tonal.js의 tension calculator를 사용해야 하지만, 여기서는 간단히 구현
   */
  calculateProgressionDistance(positions) {
    if (positions.length === 0) return 0;
    
    // 간단한 구현: 평균 instability를 distance로 사용
    const notes = positions.map(p => p.note);
    const totalInstability = notes.reduce((sum, note) => {
      return sum + (INSTABILITY_MAP[note] || 0);
    }, 0);
    
    return totalInstability / notes.length;
  }

  /**
   * 새로운 유저 배치 (메인 함수)
   * @param {Number} userNote - 12-tone note index (0-11)
   * @param {Number} totalUsers - Total number of users/particles
   * @returns {Number} Position index (0-35): voice * 12 + step
   */
  assignNewUser(userNote, totalUsers) {
    const availablePositions = this.getAvailablePositions();
    
    if (availablePositions.length === 0) {
      console.warn('[GlobalHarmonicPlacer] No available positions');
      return -1;
    }
    
    // Phase 1: 제약 필터링
    const validPositions = availablePositions.filter(pos => {
      return this.satisfiesConstraints(userNote, pos, totalUsers);
    });
    
    if (validPositions.length === 0) {
      // 제약이 너무 강하면 랜덤
      console.warn('[GlobalHarmonicPlacer] No valid positions, using random');
      return availablePositions[Math.floor(Math.random() * availablePositions.length)];
    }
    
    // Phase 2: Harmonic distance 최적화
    const targetDistance = this.calculateTargetDistance(totalUsers);
    const scored = validPositions.map(pos => {
      const score = this.evaluateHarmonicScore(userNote, pos, targetDistance);
      return { position: pos, score };
    });
    
    // Phase 3: Weighted random (랜덤성 유지)
    return this.weightedRandomSelect(scored);
  }

  /**
   * 제약 만족 확인
   */
  satisfiesConstraints(noteIndex, position, totalUsers) {
    const instability = INSTABILITY_MAP[noteIndex] || 0;
    const step = position % 12;
    const distanceToCycleEnd = 12 - step;
    
    // 불안정한 음은 cycle 끝나기 전에 해결 가능해야 함
    if (instability > 5 && distanceToCycleEnd < 3) {
      // 해결 음이 이후에 있는지 확인
      const hasResolution = this.checkResolutionAvailable(step, 0); // C로 해결
      return hasResolution;
    }
    
    return true;
  }

  /**
   * Harmonic score 평가
   */
  evaluateHarmonicScore(userNote, position, targetDistance) {
    // 임시 배치
    const tempPositions = [...this.assignedPositions, {
      note: userNote,
      position,
      voice: Math.floor(position / 12),
      step: position % 12
    }];
    
    // 새로운 progression distance
    const newDistance = this.calculateProgressionDistance(tempPositions);
    
    // 목표에 가까울수록 높은 점수
    const distanceScore = 1 / (1 + Math.abs(newDistance - targetDistance));
    
    // 위치 점수 (중간 위치 선호)
    const step = position % 12;
    const positionScore = 1 - Math.abs(step - 6) / 6;
    
    return distanceScore * positionScore;
  }

  /**
   * 해결 가능 여부 확인
   */
  checkResolutionAvailable(currentStep, resolutionNote) {
    // 이후 3 step 내에 해결 음이 있는가?
    for (let i = 1; i <= 3; i++) {
      const checkStep = (currentStep + i) % 12;
      const hasNote = this.assignedPositions.some(p => 
        p.step === checkStep && p.note === resolutionNote
      );
      if (hasNote) return true;
    }
    
    // 미래에 배치될 수 있는 위치가 있는가?
    // (실제로는 미래 예측 필요, 여기서는 간단히 true)
    return true;
  }

  /**
   * Weighted random selection
   */
  weightedRandomSelect(candidates) {
    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    if (total === 0) {
      return candidates[0]?.position || -1;
    }
    
    let random = Math.random() * total;
    
    for (const c of candidates) {
      random -= c.score;
      if (random <= 0) return c.position;
    }
    
    return candidates[0]?.position || -1;
  }

  /**
   * 사용 가능한 위치 (0-35)
   */
  getAvailablePositions() {
    const used = new Set(this.assignedPositions.map(p => p.position));
    return Array.from({ length: 36 }, (_, i) => i)
      .filter(p => !used.has(p));
  }

  /**
   * Assignment 추가 (외부에서 호출)
   */
  addAssignment(noteIndex, position) {
    this.assignedPositions.push({
      note: noteIndex,
      position,
      voice: Math.floor(position / 12),
      step: position % 12
    });
  }

  /**
   * 기존 assignments 맵으로부터 업데이트
   * @param {Object} assignments - { particleId: { voice: 'bass'|'baritone'|'tenor', column: 0-11 } }
   * @param {Array} particles - Array of particle objects with getActiveNoteIndex method
   */
  updateAssignmentsFromMap(assignments, particles) {
    this.assignedPositions = [];
    
    particles.forEach(particle => {
      const assignment = assignments[particle.id];
      if (assignment && assignment.voice && assignment.column !== undefined) {
        const noteIndex = particle.getActiveNoteIndex();
        if (noteIndex >= 0 && noteIndex < 12) {
          const voices = ['bass', 'baritone', 'tenor'];
          const voiceIndex = voices.indexOf(assignment.voice);
          if (voiceIndex >= 0) {
            const position = voiceIndex * 12 + assignment.column;
            this.assignedPositions.push({
              note: noteIndex,
              position,
              voice: voiceIndex,
              step: assignment.column
            });
          }
        }
      }
    });
  }

  /**
   * 특정 파티클의 assignment 제거
   */
  removeAssignment(particleId, assignments) {
    // assignments 맵에서 제거하고, assignedPositions도 업데이트
    delete assignments[particleId];
    // assignedPositions는 updateAssignmentsFromMap으로 다시 동기화됨
  }
}

