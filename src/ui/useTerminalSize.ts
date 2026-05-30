import { useEffect, useState } from "react";

export interface TerminalSize {
  rows: number | undefined;
  columns: number | undefined;
}

// Ink re-renders the existing tree on terminal resize but does not re-run the
// component, so anything computed from `stdout.rows`/`stdout.columns` at render
// time goes stale. Subscribing to the `resize` event and storing the size in
// state forces a real re-render with the new dimensions.
export function useTerminalSize(stdout: NodeJS.WriteStream): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({ rows: stdout.rows, columns: stdout.columns });
  useEffect(() => {
    const sync = () =>
      setSize((prev) =>
        // Keep the previous object when nothing changed so we don't re-render needlessly.
        prev.rows === stdout.rows && prev.columns === stdout.columns
          ? prev
          : { rows: stdout.rows, columns: stdout.columns },
      );
    // The terminal may have changed between the initial render and this effect.
    sync();
    if (typeof stdout.on !== "function") return;
    stdout.on("resize", sync);
    return () => {
      stdout.off("resize", sync);
    };
  }, [stdout]);
  return size;
}
