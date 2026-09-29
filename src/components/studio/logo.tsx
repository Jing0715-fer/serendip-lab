'use client';

// logo.tsx — Serendip Lab 标志（放大镜 × DNA 双螺旋）

export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* 放大镜镜片 */}
      <circle cx="20" cy="20" r="12.5" stroke="#b45309" strokeWidth="3" fill="rgba(253, 250, 241, 0.55)" />
      <circle cx="20" cy="20" r="12.5" stroke="#9a3412" strokeWidth="0.8" fill="none" opacity="0.5" />
      {/* 镜片高光 */}
      <path d="M13 15 Q16 11.5 21 12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" fill="none" />
      {/* DNA 双螺旋（镜片内） */}
      <path d="M15 27 Q20 21 20 20 Q20 19 25 13" stroke="#b91c1c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M15 13 Q20 19 20 20 Q20 21 25 27" stroke="#15803d" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M16.2 16.4 L23.8 16.4 M15.4 20 L24.6 20 M16.2 23.6 L23.8 23.6" stroke="#78716c" strokeWidth="1.1" strokeLinecap="round" />
      {/* 手柄 */}
      <path d="M29.5 29.5 L39 39" stroke="#92400e" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M29.5 29.5 L39 39" stroke="#b45309" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
