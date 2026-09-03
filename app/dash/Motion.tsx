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

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type Variants } from "framer-motion";
import { useEffect, useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";

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

const TILT_DEG = 12;

/**
 * A real 3D card: rotateX/rotateY track the cursor, a radial glow tracks it
 * too, and content sits on its own translateZ layer so it visibly lifts off
 * the card — depth plus a light source, not just a flat hover-scale. Floats
 * gently at rest so it still reads as "alive" before anyone touches it.
 */
export function TiltCard({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rotateX = useSpring(rawX, LIQUID_SPRING);
  const rotateY = useSpring(rawY, LIQUID_SPRING);
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);
  const glow = useTransform(
    [glowX, glowY],
    ([x, y]: number[]) => `radial-gradient(circle at ${x}% ${y}%, rgba(255,46,76,0.2), transparent 60%)`
  );

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rawX.set((0.5 - py) * TILT_DEG);
    rawY.set((px - 0.5) * TILT_DEG);
    glowX.set(px * 100);
    glowY.set(py * 100);
  }
  function onLeave() {
    rawX.set(0);
    rawY.set(0);
  }

  return (
    <div style={{ perspective: 1000 }}>
      <motion.div
        ref={ref}
        className={className}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d", backgroundImage: glow }}
        animate={{ y: [0, -3, 0] }}
        transition={{ y: { duration: 4.5, repeat: Infinity, ease: "easeInOut" } }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div style={{ transform: "translateZ(28px)" }}>{children}</div>
      </motion.div>
    </div>
  );
}

/**
 * A lighter tilt for small clickable elements (a day column, a chip) — same
 * cursor-tracked rotateX/rotateY as TiltCard, no idle float and no glow,
 * plus a real onClick so a bar chart column can double as a button.
 */
export function TiltButton3D({
  className, children, onClick,
}: { className?: string; children: ReactNode; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rotateX = useSpring(rawX, LIQUID_SPRING);
  const rotateY = useSpring(rawY, LIQUID_SPRING);

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rawX.set((0.5 - py) * TILT_DEG);
    rawY.set((px - 0.5) * TILT_DEG);
  }
  function onLeave() {
    rawX.set(0);
    rawY.set(0);
  }

  // className carries layout (e.g. `.day`'s flex:1/height:100% inside `.week`'s
  // flex row) — it has to land on this outer element or the flex item sizing
  // breaks. The inner motion.div just re-declares the same column layout so
  // its children (.n/.col/.lab) stack exactly as before, with tilt added.
  return (
    <div className={className} style={{ perspective: 800 }}>
      <motion.div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClick}
        style={{
          rotateX, rotateY, transformStyle: "preserve-3d",
          cursor: onClick ? "pointer" : undefined,
          display: "flex", flexDirection: "column", alignItems: "center",
          width: "100%", height: "100%",
        }}
        whileHover={onClick ? { scale: 1.05 } : undefined}
        whileTap={onClick ? { scale: 0.95 } : undefined}
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * A big glass card that pops open with real 3D — rotateX flips it in rather
 * than just fading, so opening a day feels like turning it toward you.
 * Closes on backdrop click or Escape.
 */
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.82, rotateX: -20 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0 }}
            exit={{ opacity: 0, scale: 0.88, rotateX: 14 }}
            transition={LIQUID_SPRING}
            style={{ transformStyle: "preserve-3d", perspective: 1200 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A week-chart bar that actually grows in. The server renders the final
 * height directly (no client state change happens), so a plain CSS
 * `transition: height` — what was here before — never has anything to
 * animate from. This is the one place that genuinely needs client state:
 * start at 0 and spring up to the real value once mounted.
 */
export function GrowBar({ heightPct, className }: { heightPct: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ height: 0 }}
      animate={{ height: `${heightPct}%` }}
      transition={LIQUID_SPRING}
    />
  );
}
