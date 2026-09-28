"use client";

const Controls = () => {
  return (
    <div className="absolute bottom-10 right-10 hidden flex-col gap-3 text-xs text-white/70 sm:flex">
      <span className="rounded-full border border-white/20 px-3 py-1">
        드래그로 이동
      </span>
      <span className="rounded-full border border-white/20 px-3 py-1">
        더블탭/클릭: 예정된 액션
      </span>
    </div>
  );
};

export default Controls;
