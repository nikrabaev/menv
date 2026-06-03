import { render, useApp } from "ink";
import type React from "react";

// Render an inline (non-fullscreen) Ink prompt: mount it, resolve via
// useApp().exit() from a callback, then fully unmount before the next prompt
// mounts so its useInput owns stdin cleanly. Returns `fallback` if the prompt
// exits without resolving (e.g. the user cancels).
export async function inlinePrompt<T>(
  node: (resolve: (v: T) => void) => React.ReactElement,
  fallback: T,
): Promise<T> {
  let result = fallback;
  const Wrapper = () => {
    const { exit } = useApp();
    return node((v) => {
      result = v;
      exit();
    });
  };
  const instance = render(<Wrapper />);
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    instance.cleanup();
  }
  return result;
}
