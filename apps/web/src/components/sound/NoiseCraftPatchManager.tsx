"use client";
/**
 * NoiseCraftPatchManager — the patch list of the sound workspace (ported from umwelt/src/components/
 * NoiseCraftPatchManager.tsx): list, create, duplicate, rename, delete (Delete key on the selected card), open.
 * Files live in apps/web/noisecraft/examples/ through the /noisecraft/* routes.
 */

import React, { useCallback, useEffect, useState } from "react";
import styles from "./NoiseCraftPatchManager.module.css";

interface Patch {
  filename: string;
  size: number;
  lastModified: number;
}

export default function NoiseCraftPatchManager({ onSelectPatch }: { onSelectPatch: (filename: string) => void }) {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPatchName, setNewPatchName] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedPatch, setSelectedPatch] = useState<string | null>(null);

  const fetchPatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/noisecraft/list-patches?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) setPatches(((await res.json()) as { patches?: Patch[] }).patches ?? []);
    } catch (err) {
      console.error("Failed to fetch patches", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchPatches(), 0);
    return () => clearTimeout(t);
  }, [fetchPatches]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPatch && (e.target as HTMLElement | null)?.tagName !== "INPUT") {
        if (!window.confirm(`${selectedPatch} 을(를) 지울까요?`)) return;
        setLoading(true);
        try {
          const res = await fetch("/noisecraft/delete-patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: selectedPatch }) });
          if (res.ok) {
            setSelectedPatch(null);
            await fetchPatches();
          } else alert("삭제 실패: " + ((await res.json()) as { error?: string }).error);
        } finally {
          setLoading(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPatch, fetchPatches]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatchName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/noisecraft/create-patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newPatchName.trim() }) });
      if (res.ok) {
        const data = (await res.json()) as { filename: string };
        setNewPatchName("");
        await fetchPatches();
        onSelectPatch(data.filename);
      } else alert("생성 실패: " + ((await res.json()) as { error?: string }).error);
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, sourceFile: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newName = `${sourceFile.replace(".ncft", "")}_copy_${Math.floor(Math.random() * 1000).toString(36)}`;
    setLoading(true);
    try {
      const res = await fetch("/noisecraft/duplicate-patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceFile, newName }) });
      if (res.ok) await fetchPatches();
      else alert("복제 실패: " + ((await res.json()) as { error?: string }).error);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (e: React.MouseEvent, filename: string) => {
    e.stopPropagation();
    const newName = window.prompt(`${filename} 의 새 이름:`, filename.replace(".ncft", ""));
    if (!newName) return;
    let safe = newName.trim();
    if (!safe.endsWith(".ncft")) safe += ".ncft";
    if (safe === filename) return;
    setLoading(true);
    try {
      const res = await fetch("/noisecraft/rename-patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldFilename: filename, newFilename: safe }) });
      if (res.ok) {
        if (selectedPatch === filename) setSelectedPatch(safe);
        await fetchPatches();
      } else alert("이름 변경 실패: " + ((await res.json()) as { error?: string }).error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>NoiseCraft 패치</h2>
        <p>패치를 골라 편집하거나 새로 만듭니다. 편집은 자동 저장됩니다 (apps/web/noisecraft/examples/).</p>
      </div>
      <div className={styles.createSection}>
        <form onSubmit={handleCreate}>
          <input type="text" placeholder="새 패치 이름…" value={newPatchName} onChange={(e) => setNewPatchName(e.target.value)} disabled={creating} className={styles.input} />
          <button type="submit" disabled={!newPatchName.trim() || creating} className={styles.btn}>
            {creating ? "만드는 중…" : "+ 새 패치"}
          </button>
        </form>
      </div>
      <div className={styles.patchList}>
        {loading ? (
          <div className={styles.loading}>불러오는 중…</div>
        ) : patches.length === 0 ? (
          <div className={styles.empty}>패치가 없습니다.</div>
        ) : (
          patches.map((patch) => (
            <div
              key={patch.filename}
              className={`${styles.patchCard} ${selectedPatch === patch.filename ? styles.selected : ""}`}
              onClick={() => setSelectedPatch(patch.filename)}
              onDoubleClick={() => onSelectPatch(patch.filename)}
            >
              <div className={styles.patchIcon}>🎹</div>
              <div className={styles.patchInfo}>
                <div className={styles.patchTitle}>{patch.filename.replace(".ncft", "")}</div>
                <div className={styles.patchMeta}>
                  {(patch.size / 1024).toFixed(1)} KB · {new Date(patch.lastModified).toLocaleString()}
                </div>
              </div>
              <div className={styles.patchActions}>
                <button className={styles.duplicateBtn} onClick={(e) => handleRename(e, patch.filename)} title="이름 바꾸기">
                  ✎
                </button>
                <button className={styles.duplicateBtn} onClick={(e) => handleDuplicate(e, patch.filename)} title="복제">
                  ⧉
                </button>
                <button
                  className={styles.openBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPatch(patch.filename);
                  }}
                >
                  편집
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
