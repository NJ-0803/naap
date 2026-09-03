"use client";

/**
 * Liquid-glass motion primitives, carried over from the palate app's motion
 * contract: every transition is a spring, never a fixed duration/easing
 * curve, so motion always responds to how far a thing has to travel.
 *
 * Naap's server component (page.tsx) does the data fetching; these are the
 * only client-rendered pieces, kept deliberately small so the rest of the
 * dashboard stays a zero-JS server render.
 */

import { motion, type Variants } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";

export const LIQUID_SPRING = { type: "spring" as const, damping: 15, stiffness: 120, mass: 0.5 };
const TAP_SCALE = { scale: 0.97 };
const HOVER_SCALE = { scale: 1.015 };

const reveal: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: LIQUID_SPRING },
};

/** Fades/slides a section up once, as it scrolls into view. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      variants={reveal}
    >
      {children}
    </motion.div>
  );
}

/** A glass surface that lifts slightly on hover/tap — for any clickable card or row. */
export function Lift({ className, children, ...rest }: ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      className={className}
      whileHover={HOVER_SCALE}
      whileTap={TAP_SCALE}
      transition={LIQUID_SPRING}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Same lift, on the actual <form> element, so Server Actions still bind directly to it. */
export function LiftForm({ className, children, ...rest }: ComponentProps<typeof motion.form>) {
  return (
    <motion.form
      className={className}
      whileHover={HOVER_SCALE}
      whileTap={TAP_SCALE}
      transition={LIQUID_SPRING}
      {...rest}
    >
      {children}
    </motion.form>
  );
}

export function LiftButton(props: ComponentProps<typeof motion.button>) {
  return <motion.button whileHover={HOVER_SCALE} whileTap={TAP_SCALE} transition={LIQUID_SPRING} {...props} />;
}
