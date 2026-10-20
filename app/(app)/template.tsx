"use client";

import { motion, useReducedMotion } from "motion/react";

// Each page enters with a short fade and a 4px rise; the floating navigation stays still.
export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="flex min-h-full flex-1 flex-col [&>*:not([data-fill])]:shrink-0"
    >
      {children}
    </motion.div>
  );
}
