/* HermyHQ wordmark: shared by the sidebar, mobile header, and login page. */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <div className={`flex items-center ${lg ? "gap-3" : "gap-2.5"}`}>
      <div
        className={`${lg ? "w-11 h-11" : "w-8 h-8"} rounded-[var(--r-sm)] border border-[var(--accent)] bg-[var(--surface-1)] flex items-center justify-center`}
      >
        <span className={`text-[var(--accent)] font-mono font-bold tracking-tight ${lg ? "text-[17px]" : "text-[13px]"}`}>&gt;_</span>
      </div>
      <span className={`font-mono text-[var(--text)] tracking-[-0.01em] uppercase ${lg ? "text-[20px]" : "text-[15px]"}`}>
        Hermy<span className="text-[var(--accent)]">HQ</span>
      </span>
    </div>
  );
}
