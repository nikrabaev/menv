// Terminal dimensions as React state — re-renders on SIGWINCH (Node emits
// "resize" on stdout). Floor handling lives in app.tsx.

import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface ScreenSize {
  columns: number;
  rows: number;
}

export const MIN_COLUMNS = 80;
export const MIN_ROWS = 20;

export function useScreenSize(): ScreenSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<ScreenSize>({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 30 });
  useEffect(() => {
    const onResize = (): void => setSize({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 30 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
