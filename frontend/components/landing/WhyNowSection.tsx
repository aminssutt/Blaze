// Landing v3 — Section 01 · WHY NOW. Three sourced facts from the real
// 2026 French wildfire season, each linking to its article, then one
// transition line into the product.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

const FRANCEINFO_URL =
  "https://www.franceinfo.fr/faits-divers/incendie/les-incendies-ont-brule-au-moins-44-000-hectares-en-france-en-2026-et-128-personnes-ont-ete-interpellees-annonce-laurent-nunez-en-gironde_8118410.html";
const TOUTELEUROPE_URL =
  "https://www.touteleurope.eu/environnement/feux-de-foret-plus-de-42-000-hectares-deja-brules-en-france-en-2026-un-record-a-la-mi-juillet/";

const FACTS = [
  {
    value: "44,000 ha",
    text: "burned in France in 2026 — a record reached by mid-July.",
    source: "Franceinfo",
    href: FRANCEINFO_URL,
  },
  {
    value: "12,500",
    text: "fire starts since January.",
    source: "Franceinfo",
    href: FRANCEINFO_URL,
  },
  {
    value: "2/3",
    text: "of the 2022 record already — before the height of summer.",
    source: "Toute l'Europe",
    href: TOUTELEUROPE_URL,
  },
];

export default function WhyNowSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="why-now"
      aria-labelledby="why-now-title"
      className="scroll-mt-20 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="01" label="Why now" />
          <h2
            id="why-now-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
            style={{ color: "var(--blaze-text)" }}
          >
            Summer 2026 is already a record wildfire season in France.
          </h2>
        </Reveal>

        <motion.div
          className="mt-10 grid gap-4 sm:grid-cols-3"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {FACTS.map((fact) => (
            <motion.a
              key={fact.text}
              variants={fadeUp}
              href={fact.href}
              target="_blank"
              rel="noreferrer"
              className="group block border-l-2 py-1 pl-4 transition-opacity hover:opacity-90"
              style={{ borderColor: "var(--blaze-accent-dim)" }}
            >
              <p
                className="font-mono text-3xl font-semibold tracking-tight"
                style={{ color: "var(--blaze-text)" }}
              >
                {fact.value}
              </p>
              <p
                className="mt-1.5 text-[14px] leading-snug"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                {fact.text}
              </p>
              <p
                className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] underline-offset-4 group-hover:underline"
                style={{ color: "var(--blaze-accent)" }}
              >
                {fact.source} ↗
              </p>
            </motion.a>
          ))}
        </motion.div>

        <Reveal delay={0.1}>
          <p
            className="mt-10 max-w-2xl text-[16px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            On the ground, every unit already describes the situation over the
            radio. BLAZE turns those voices into decisions.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
