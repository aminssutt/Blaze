// Landing — Section 01 · WHY NOW. Three facts from the real 2026 French
// wildfire season, each presented as a rich preview of the article it came
// from: outlet, real headline, publication date, and the figure itself.
//
// Why previews and not embeds: both outlets refuse to be framed —
// touteleurope.eu sends `X-Frame-Options: sameorigin`, and franceinfo would
// render its consent wall inside the iframe. Outlet artwork is not hotlinked
// either: it is someone else's copyright, and a product whose whole claim is
// "nothing leaves the machine" should not open a third-party connection to
// decorate a landing page. The outlet mark is drawn from type instead.
//
// Every headline, date and figure below was read off the live articles. Nothing
// here is paraphrased into existence — the headlines stay in French, marked
// `lang="fr"`, because that is what they actually say.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

type Source = {
  outlet: string;
  /** Two-letter mark drawn in place of a hotlinked logo. */
  mark: string;
  /** The article's real headline, verbatim, in its own language. */
  headline: string;
  /** Publication date as printed by the outlet. */
  date: string;
  href: string;
};

const FRANCEINFO: Source = {
  outlet: "Franceinfo",
  mark: "fi",
  headline:
    "Les incendies ont brûlé au moins 44 000 hectares en France en 2026, annonce Laurent Nuñez, 128 personnes interpellées",
  date: "22.07.2026",
  href: "https://www.franceinfo.fr/faits-divers/incendie/les-incendies-ont-brule-au-moins-44-000-hectares-en-france-en-2026-et-128-personnes-ont-ete-interpellees-annonce-laurent-nunez-en-gironde_8118410.html",
};

const TOUTE_LEUROPE: Source = {
  outlet: "Toute l'Europe",
  mark: "te",
  headline:
    "Feux de forêt : plus de 42 000 hectares déjà brûlés en France en 2026, un record à la mi-juillet",
  date: "21.07.2026",
  href: "https://www.touteleurope.eu/environnement/feux-de-foret-plus-de-42-000-hectares-deja-brules-en-france-en-2026-un-record-a-la-mi-juillet/",
};

const FACTS: { value: string; text: string; source: Source }[] = [
  {
    value: "44,000 ha",
    text: "burned across France so far in 2026 — already more than the whole of 2022.",
    source: FRANCEINFO,
  },
  {
    value: "12,500",
    text: "separate fire starts recorded across the country this year.",
    source: FRANCEINFO,
  },
  {
    value: "2/3",
    text: "of France's all-time record year already matched by mid-July.",
    source: TOUTE_LEUROPE,
  },
];

function ArticleCard({ fact }: { fact: (typeof FACTS)[number] }) {
  const { source } = fact;
  return (
    <motion.a
      variants={fadeUp}
      href={source.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-lg border p-5 transition-colors duration-200 hover:border-[var(--blaze-accent-dim)]"
      style={{
        background: "var(--blaze-bg-raised)",
        borderColor: "var(--blaze-border)",
      }}
    >
      <p
        className="font-mono text-[2.15rem] font-semibold leading-none tracking-tight"
        style={{ color: "var(--blaze-text)" }}
      >
        {fact.value}
      </p>
      <p
        className="mt-2.5 text-[14px] leading-snug"
        style={{ color: "var(--blaze-text-muted)" }}
      >
        {fact.text}
      </p>

      {/* the article this figure was read from */}
      <div
        className="mt-5 border-t pt-4"
        style={{ borderColor: "var(--blaze-border)" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded font-mono text-[11px] font-bold uppercase tracking-tight"
            style={{
              background: "var(--blaze-bg-overlay)",
              color: "var(--blaze-accent)",
              border: "1px solid var(--blaze-accent-dim)",
            }}
          >
            {source.mark}
          </span>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: "var(--blaze-text)" }}
          >
            {source.outlet}
          </span>
          <span
            className="ml-auto font-mono text-[11px] tabular-nums"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            {source.date}
          </span>
        </div>

        <p
          lang="fr"
          className="mt-2.5 line-clamp-3 min-h-[3.15lh] text-[12.5px] italic leading-snug"
          style={{ color: "var(--blaze-text-muted)" }}
        >
          « {source.headline} »
        </p>

        <p
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] underline-offset-4 group-hover:underline"
          style={{ color: "var(--blaze-accent)" }}
        >
          Read the article ↗
        </p>
      </div>
    </motion.a>
  );
}

export default function WhyNowSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="why-now"
      aria-labelledby="why-now-title"
      className="scroll-mt-20 py-12 lg:py-14"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <div className="grid gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end">
            <div>
              <Eyebrow index="01" label="Why now" />
              <h2
                id="why-now-title"
                className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
                style={{ color: "var(--blaze-text)" }}
              >
                Summer 2026 is already a record wildfire season in France.
              </h2>
            </div>
            <p
              className="text-[15px] leading-relaxed lg:pb-1"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              On the ground, every unit already describes the situation over the
              radio. BLAZE turns those voices into decisions.
            </p>
          </div>
        </Reveal>

        <motion.div
          className="mt-9 grid gap-4 sm:grid-cols-3"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {FACTS.map((fact) => (
            <ArticleCard key={fact.value} fact={fact} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
