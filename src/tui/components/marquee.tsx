// A description that scrolls to reveal its tail when its card is active. While
// inactive (or when the text fits `width`) it shows the static truncated head.
// When activated and overflowing, it waits 1s, then scrolls one column at a
// time and STOPS at the end — it never loops. Deactivating reverts to the head.
// Only the selected card is ever active, so at most one timer runs at a time.
import { useEffect, useState } from "react";
import { marqueeSlice, truncate } from "../state/selectors.ts";

const START_DELAY_MS = 1000;
const STEP_MS = 120;

export function useMarquee(text: string, width: number, active: boolean): string {
  const [step, setStep] = useState(0);
  const overflow = width > 0 && text.length > width;

  useEffect(() => {
    if (!active || !overflow) {
      setStep(0);
      return;
    }
    const max = text.length - width;
    let current = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
      interval = setInterval(() => {
        current += 1;
        setStep(current);
        if (current >= max && interval !== undefined) clearInterval(interval);
      }, STEP_MS);
    }, START_DELAY_MS);
    return () => {
      clearTimeout(delay);
      if (interval !== undefined) clearInterval(interval);
      setStep(0);
    };
  }, [text, width, active, overflow]);

  if (!overflow) return text;
  if (step === 0) return truncate(text, width); // initial / reverted state, with ellipsis
  return marqueeSlice(text, width, step);
}
